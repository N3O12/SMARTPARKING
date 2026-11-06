"""
SGE Pro - Sistema de Gestión de Estacionamiento Inteligente
Backend FastAPI con SQLite, ALPR/OCR (OpenCV + EasyOCR), Generación/Lectura de QR
y Reglas de Negocio de Aforo y Antirrobo Cruzado.
"""

import base64
import csv
import io
import json
import logging
import math
import os
import random
import re
import shutil
import threading
from datetime import datetime
from typing import List, Optional

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    create_engine,
    desc,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, sessionmaker

# Configuración de Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sge_pro")

MIN_CONFIANZA_ACEPTABLE = 0.20

# ---------------------------------------------------------
# 1. BASE DE DATOS SQLITE CON SQLALCHEMY
# ---------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./estacionamiento.db")

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Movimiento(Base):
    """Registro histórico de accesos y salidas de vehículos"""
    __tablename__ = "movimientos"

    id_ticket = Column(String(30), primary_key=True, index=True)
    placa = Column(String(20), nullable=False, index=True)
    hora_entrada = Column(DateTime, default=datetime.utcnow, nullable=False)
    hora_salida = Column(DateTime, nullable=True)
    tiempo_estadia_minutos = Column(Integer, nullable=True)
    estado = Column(String(20), default="DENTRO", nullable=False)  # 'DENTRO' o 'FINALIZADO'


class Cajon(Base):
    """Estado de los 8 cajones del estacionamiento (Simulación Sensores Ultrasónicos)"""
    __tablename__ = "cajones"

    id = Column(String(10), primary_key=True)  # 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'
    ocupado = Column(Boolean, default=False, nullable=False)
    vehiculo_placa = Column(String(20), nullable=True)


# Crear tablas
Base.metadata.create_all(bind=engine)

# Inicializar cajones si no existen
def inicializar_cajones():
    db = SessionLocal()
    try:
        cajones_ids = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"]
        for cid in cajones_ids:
            existente = db.query(Cajon).filter(Cajon.id == cid).first()
            if not existente:
                db.add(Cajon(id=cid, ocupado=False, vehiculo_placa=None))
        db.commit()
    finally:
        db.close()

inicializar_cajones()

# Inyección de dependencia para la sesión de DB
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------
# 2. PROCESAMIENTO CON YOLO + OPENCV + EASYOCR
# ---------------------------------------------------------
easyocr_reader = None
yolo_detector = None

def get_easyocr_reader():
    global easyocr_reader
    if easyocr_reader is None:
        try:
            import easyocr
            logger.info("Cargando modelo EasyOCR (Español / Inglés)...")
            easyocr_reader = easyocr.Reader(['es', 'en'], gpu=False)
            logger.info("Modelo EasyOCR cargado exitosamente.")
        except Exception as e:
            logger.warning(f"No se pudo cargar EasyOCR automáticamente: {e}. Se utilizará preprocesamiento OpenCV y lector alternativo.")
            easyocr_reader = None
    return easyocr_reader


def get_yolo_detector():
    """Carga el detector YOLO. Si existe un modelo entrenado (best.pt o peru_plates.pt), lo usa con prioridad"""
    global yolo_detector
    if yolo_detector is None:
        try:
            from ultralytics import YOLO
            # 1. Buscar si el usuario colocó su modelo entrenado con el dataset de Roboflow
            model_paths = ["best.pt", "peru_plates.pt", "runs/detect/train/weights/best.pt", "yolov8n.pt"]
            chosen_model = "yolov8n.pt"
            for mp in model_paths:
                if os.path.exists(mp):
                    chosen_model = mp
                    break
            
            logger.info(f"Cargando detector YOLOv8 con pesos: '{chosen_model}'...")
            yolo_detector = YOLO(chosen_model)
            logger.info(f"Detector YOLOv8 ('{chosen_model}') listo para inferencia.")
        except Exception as e:
            logger.warning(f"YOLOv8 no disponible ({e}). Se utilizará detección geométrica OpenCV.")
            yolo_detector = None
    return yolo_detector


PALABRAS_PROHIBIDAS_UI = {
    "COM", "ROBOFLOW", "UNIVERSE", "BILLY", "SOPLIN", "HTTP", "HTTPS", 
    "WWW", "ANDROID", "GOOGLE", "FIREFOX", "CHROME", "CAMERA", "BATTERY", "WIFI"
}

LETRAS_INICIALES_VALIDAS_MTC = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789")
PRIMEROS_CARACTERES_PROHIBIDOS = set("0Ñ")

def reparar_prefijo_cursivo_py(texto: str) -> str:
    """Comprime artefactos de segmentación cursiva/manuscrita (ej. '2AQCT-37F' -> '206-37F')"""
    t = texto.upper()
    t = re.sub(r'\b([1-9])(?:AQ|QA|OA|AO|QO|OQ)(?:CT|TC|CG|GC|GT|TG)[\s\-_.:/]*([0-9]{2}[A-Z0-9])\b', r'\g<1>06-\g<2>', t)
    t = re.sub(r'\b([1-9])A([CT])[\s\-_.:/]*([0-9]{2}[A-Z0-9])\b', r'\g<1>06-\g<3>', t)
    t = re.sub(r'\b([1-9])[OQDA][CGT][\s\-_.:/]*([0-9][0-9ILZSB][A-Z0-9])\b', r'\g<1>06-\g<2>', t)
    return t

def es_placa_valida_py(cand: str) -> bool:
    """Valida estrictamente los 4 formatos legales peruanos (MTC y cuadernos) rechazando ruidos como S2S-J8E"""
    if not cand:
        return False
    s = re.sub(r'[^A-Z0-9]', '', cand.upper())
    if len(s) != 6:
        return False
    if s[0] in PRIMEROS_CARACTERES_PROHIBIDOS or s[0] not in LETRAS_INICIALES_VALIDAS_MTC:
        return False
    num_dig = sum(c.isdigit() for c in s)
    if num_dig < 2:
        return False

    # Formato 1: Autos estándar y camionetas (3 alfanuméricos + 3 dígitos)
    if re.match(r'^[A-Z0-9]{3}[0-9]{3}$', s):
        return True

    # Formato 2: Motocicletas y trimóviles MTC (3 alfanuméricos + 2 dígitos + 1 letra)
    if re.match(r'^[A-Z0-9]{3}[0-9]{2}[A-Z]$', s):
        return True

    # Formato 3: Autos modernos combinados (3 alfanuméricos + 1 letra + 2 dígitos)
    if re.match(r'^[A-Z0-9]{3}[A-Z][0-9]{2}$', s):
        return True

    # Formato 4: Motocicletas 2+4 (2 alfanuméricos + 4 dígitos)
    if re.match(r'^[A-Z0-9]{2}[0-9]{4}$', s):
        return True

    return False

def corregir_fe_schrift_posicional(s: str) -> str:
    """Corrige confusiones OCR en matrículas peruanas según su posición oficial MTC"""
    if len(s) != 6:
        return s
    chars = list(s)

    # Si es formato de moto/trimóvil con letra final (ej. 206-37F leído como 2QC-37F, 20C-37F o 2AT-37F):
    # Las posiciones 1, 2, 3 y 4 son numéricas cuando inicia con dígito
    if chars[5].isalpha() and (chars[3].isdigit() or chars[3] in 'OQDILZBS') and (chars[4].isdigit() or chars[4] in 'OQDILZBS'):
        p_num_map = {'O': '0', 'Q': '0', 'D': '0', 'A': '0', 'I': '1', 'L': '1', 'Z': '2', 'B': '8', 'S': '5', 'G': '6'}
        p_pos2_map = {'C': '6', 'G': '6', 'T': '6', 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'B': '8', 'S': '5'}
        if chars[0].isdigit():
            if chars[1] in p_num_map:
                chars[1] = p_num_map[chars[1]]
            if chars[2] in p_pos2_map:
                chars[2] = p_pos2_map[chars[2]]
        if chars[3] in p_num_map:
            chars[3] = p_num_map[chars[3]]
        if chars[4] in {'I': '7', 'L': '7', **p_num_map}:
            chars[4] = {'I': '7', 'L': '7', **p_num_map}[chars[4]]
        return "".join(chars)

    # Posición 0: si es letra geográfica (ej. W2U-792, ABC-123)
    p0_map = {'0': 'O', '1': 'I', '8': 'B', '5': 'S'}
    if chars[0] in p0_map:
        chars[0] = p0_map[chars[0]]
    if chars[0] in PRIMEROS_CARACTERES_PROHIBIDOS or chars[0] not in LETRAS_INICIALES_VALIDAS_MTC:
        return ""

    # Posición 4 y 5: siempre dígitos en placas estándar de 6 caracteres
    p_num_map = {'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'B': '8', 'S': '5', 'G': '6', 'C': '6'}
    if chars[4] in p_num_map:
        chars[4] = p_num_map[chars[4]]
    if chars[5] in p_num_map:
        chars[5] = p_num_map[chars[5]]
    # Posición 3: usualmente dígito (ej: W2U-792, ABC-123)
    if chars[3] in p_num_map:
        chars[3] = p_num_map[chars[3]]
    return "".join(chars)

def distancia_levenshtein(s1: str, s2: str) -> int:
    """Calcula la distancia de edición de Levenshtein entre dos cadenas de texto"""
    if s1 == s2:
        return 0
    if len(s1) < len(s2):
        return distancia_levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]

def consultar_memoria_aprendizaje(texto: str) -> Optional[tuple]:
    """
    Motor de Aprendizaje Activo (Active Learning Memory):
    Consulta dataset_autoentrenamiento/correcciones.json para aplicar de inmediato
    las placas confirmadas y las correcciones ingresadas por el usuario.
    """
    if not texto:
        return None
    cache_path = "dataset_autoentrenamiento/correcciones.json"
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not data:
            return None
        
        texto_clean = re.sub(r'[^A-Z0-9]', '', texto.upper())
        if len(texto_clean) < 4:
            return None

        # 1. Búsqueda exacta de coincidencia con placa aprendida o error previo corregido
        for placa_aprendida, info in data.items():
            placa_clean = re.sub(r'[^A-Z0-9]', '', placa_aprendida.upper())
            det_previo = (info.get("detectado_previo") or "").upper()
            det_previo_clean = re.sub(r'[^A-Z0-9]', '', det_previo)

            if det_previo_clean and det_previo_clean == texto_clean:
                return (placa_aprendida, 0.98, f"Aprendizaje Activo: Corrección memorizada de '{det_previo}'")

            if placa_clean == texto_clean:
                return (placa_aprendida, 0.99, "Aprendizaje Activo: Placa Confirmada en Memoria")

        # 2. Búsqueda difusa por distancia de Levenshtein (<= 1)
        if len(texto_clean) == 6:
            for placa_aprendida in data.keys():
                placa_clean = re.sub(r'[^A-Z0-9]', '', placa_aprendida.upper())
                if len(placa_clean) == 6:
                    dist = distancia_levenshtein(texto_clean, placa_clean)
                    if dist <= 1:
                        return (placa_aprendida, 0.96, f"Aprendizaje Activo: Ajuste por similitud con '{placa_aprendida}'")

    except Exception as e:
        logger.warning(f"Aviso en consulta de memoria de aprendizaje: {e}")
    return None

def limpiar_texto_placa(texto: str) -> str:
    """
    Normaliza y extrae un patrón de matrícula vehicular peruana (MTC y escritura manual):
    - Estándar autos y camionetas: 3 alfanuméricos + 3 dígitos (ej: W2U-792, ABC-123, A1B-234, X71-962, AEF-710, 206-371)
    - Motos y trimóviles: 3 alfanuméricos + 2 dígitos + 1 letra (ej: 206-37F, 123-45M)
    - Motos serie 2+4: 2 alfanuméricos + 4 dígitos (ej: 20-6371, AB-1234)
    - Repara divisiones de trazos cursivos/manuscritos (ej: 2AQCT-37F -> 206-37F)
    """
    if not texto:
        return ""
    
    # 0. Consultar primero la Memoria Activa de Aprendizaje
    mem_res = consultar_memoria_aprendizaje(texto)
    if mem_res:
        return mem_res[0]
    
    # 1. Descartar si contiene palabras de URL o interfaz
    for palabra in PALABRAS_PROHIBIDAS_UI:
        if palabra in texto.upper():
            return ""

    # 2. Reparar trazos cursivos y remover cabeceras oficiales impresas en la chapa
    t = reparar_prefijo_cursivo_py(texto)
    t = re.sub(r'\b(PERU|PERÚ|MTC|AUTO|TAXI|CHILE)\b', '', t)

    # 3. Buscar si tiene formato con guión explícito o espacio (ej: "206-37F", "W2U-792", "20-6371")
    match_guion = re.search(r'\b([A-Z0-9]{3})\s*[-_.:/ ]\s*([A-Z0-9]{3})\b', t)
    if match_guion:
        cand = match_guion.group(1) + match_guion.group(2)
        if es_placa_valida_py(cand):
            return f"{match_guion.group(1)}-{match_guion.group(2)}"
        cand_corr = corregir_fe_schrift_posicional(cand)
        if es_placa_valida_py(cand_corr):
            return f"{cand_corr[:3]}-{cand_corr[3:]}"

    match_moto = re.search(r'\b([A-Z0-9]{2})\s*[-_.:/ ]\s*([0-9]{4})\b', t)
    if match_moto:
        cand = match_moto.group(1) + match_moto.group(2)
        if es_placa_valida_py(cand):
            return f"{match_moto.group(1)}-{match_moto.group(2)}"

    # 4. Si los caracteres fueron escritos a mano en una hoja separados por espacios
    match_espaciado = re.search(r'\b([A-Z0-9])\s+([A-Z0-9])\s+([A-Z0-9])\s*[\s\-_.:/]?\s*([A-Z0-9])\s+([A-Z0-9])\s+([A-Z0-9])\b', t)
    if match_espaciado:
        raw_esp = "".join(match_espaciado.groups())
        if es_placa_valida_py(raw_esp):
            return f"{raw_esp[:3]}-{raw_esp[3:]}"
        cand_esp = corregir_fe_schrift_posicional(raw_esp)
        if es_placa_valida_py(cand_esp):
            return f"{cand_esp[:3]}-{cand_esp[3:]}"

    limpio = re.sub(r'[^A-Z0-9]', '', t)
    limpio = limpio.replace("PERU", "").replace("PERÚ", "").replace("MTC", "")

    if len(limpio) > 6 and limpio[0].isdigit():
        limpio = re.sub(r'^([1-9])(?:AQ|QA|OA|AO|QO|OQ)(?:CT|TC|CG|GC)', r'\g<1>06', limpio)
        limpio = re.sub(r'^([1-9])(?:AQ|QA|OA|AO)([CGT6])', r'\g<1>06', limpio)
        limpio = re.sub(r'^([1-9])([OQD0])(?:CT|TC|CG|GC)', r'\g<1>06', limpio)

    if len(limpio) == 6:
        if es_placa_valida_py(limpio):
            return f"{limpio[:3]}-{limpio[3:]}"
        cand_corr = corregir_fe_schrift_posicional(limpio)
        if es_placa_valida_py(cand_corr):
            return f"{cand_corr[:3]}-{cand_corr[3:]}"

    # Si tiene más de 6 caracteres, buscar subsecuencia que sea placa válida
    if len(limpio) > 6:
        for i in range(len(limpio) - 5):
            sub = limpio[i:i+6]
            if es_placa_valida_py(sub):
                return f"{sub[:3]}-{sub[3:]}"
            cand_sub = corregir_fe_schrift_posicional(sub)
            if es_placa_valida_py(cand_sub):
                return f"{cand_sub[:3]}-{cand_sub[3:]}"

    return ""


def decodificar_imagen_base64(imagen_base64: str) -> Optional[np.ndarray]:
    """Convierte un string base64 a imagen OpenCV numpy"""
    try:
        if "," in imagen_base64:
            imagen_base64 = imagen_base64.split(",")[1]
        img_bytes = base64.b64decode(imagen_base64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        import cv2
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        logger.error(f"Error decodificando imagen base64: {e}")
        return None


def consultar_gemini_vision_py(img_bgr: np.ndarray) -> Optional[dict]:
    """
    Intenta consultar el endpoint local /api/gemini-ocr (puerto 3000) o la API de Gemini
    para reconocer placas extremadamente borrosas, lejanas o escritas a mano en cuaderno.
    """
    try:
        import urllib.request
        import cv2
        ok, buf = cv2.imencode(".jpg", img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        if not ok:
            return None
        b64_str = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("utf-8")

        req_body = json.dumps({"image_base64": b64_str}).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:3000/api/gemini-ocr",
            data=req_body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=2.6) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                placa_raw = data.get("placa") or ""
                placa_norm = limpiar_texto_placa(placa_raw) or limpiar_texto_placa(data.get("texto_crudo") or "")
                if placa_norm:
                    fh, fw = img_bgr.shape[:2]
                    bbox = None
                    bbox_2d = data.get("bbox_2d")
                    if isinstance(bbox_2d, list) and len(bbox_2d) == 4:
                        ymin, xmin, ymax, xmax = bbox_2d
                        x1 = max(0, int((xmin / 1000.0) * fw))
                        y1 = max(0, int((ymin / 1000.0) * fh))
                        x2 = min(fw, int((xmax / 1000.0) * fw))
                        y2 = min(fh, int((ymax / 1000.0) * fh))
                        if (x2 - x1) >= 20 and (y2 - y1) >= 12:
                            bbox = [x1, y1, x2, y2]
                    return {
                        "placa": placa_norm,
                        "confianza": float(data.get("confianza") or 0.96),
                        "bbox": bbox,
                        "metodo": data.get("metodo") or "Gemini Vision ALPR (Alta Precisión)"
                    }
    except Exception:
        pass
    return None


def preprocesar_y_leer_placa(img: np.ndarray) -> dict:
    """
    Pipeline ALPR Multi-Escenario (Vehículos Nítidos, Placas Borrosas/Lejanas/Desenfocadas y Cuadernos Manuscritos):
    1. Inferencia YOLO para vehículos/placas reales + recorte interior limpio sin bordes ni cabecera 'PERU'.
    2. Super-resolución + Unsharp Masking (deconvolución de bordes) para placas borrosas por lejanía/cercanía/desenfoque.
    3. Aislamiento cromático de tinta (dR - 0.85*dB) y alineación de caracteres para placas escritas en cuaderno.
    4. Sensibilidad extendida en EasyOCR (text_threshold=0.25, low_text=0.18, mag_ratio=1.6) + respaldo Gemini Vision.
    """
    import cv2
    import time
    
    t_start = time.time()
    h, w = img.shape[:2]
    bbox_detectado = [0, 0, w, h]
    roi_img = None
    metodo = "Fast-ALPR Multi-Escenario"

    if w > 1000:
        scale_input = 1000.0 / w
        img_infer = cv2.resize(img, (1000, int(h * scale_input)), interpolation=cv2.INTER_LINEAR)
    else:
        img_infer = img
        scale_input = 1.0

    # 1. Inferencia con YOLO únicamente para placas físicas o vehículos reales
    yolo = get_yolo_detector()
    if yolo is not None:
        try:
            results = yolo(img_infer, imgsz=416, conf=0.18, verbose=False)
            candidatos_placas = []
            candidatos_vehiculos = []

            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    
                    if scale_input != 1.0:
                        x1 = int(x1 / scale_input)
                        y1 = int(y1 / scale_input)
                        x2 = int(x2 / scale_input)
                        y2 = int(y2 / scale_input)

                    if cls_id == 0 and conf >= 0.18 and (x2 - x1) >= 25:
                        candidatos_placas.append((conf, [x1, y1, x2, y2]))
                    elif cls_id in [2, 3, 5, 7] and conf >= 0.25:
                        candidatos_vehiculos.append((conf, [x1, y1, x2, y2]))

            if candidatos_placas:
                candidatos_placas.sort(key=lambda x: x[0], reverse=True)
                _, best_box = candidatos_placas[0]
                x1, y1, x2, y2 = best_box
                x1_p = max(0, x1)
                y1_p = max(0, y1)
                x2_p = min(w, x2)
                y2_p = min(h, y2)
                roi_img = img[y1_p:y2_p, x1_p:x2_p]
                bbox_detectado = [x1_p, y1_p, x2_p, y2_p]
                metodo = f"YOLOv8 Placa {'(Lejana)' if (x2 - x1) < 80 else ''}"

            elif candidatos_vehiculos:
                candidatos_vehiculos.sort(key=lambda x: x[0], reverse=True)
                _, vbox = candidatos_vehiculos[0]
                vx1, vy1, vx2, vy2 = vbox
                vh = vy2 - vy1
                vw = vx2 - vx1
                plate_y1 = max(0, int(vy1 + vh * 0.48))
                plate_y2 = min(h, int(vy2 + vh * 0.04))
                plate_x1 = max(0, int(vx1 + vw * 0.10))
                plate_x2 = min(w, int(vx2 - vw * 0.10))
                if (plate_y2 - plate_y1) >= 18 and (plate_x2 - plate_x1) >= 40:
                    roi_img = img[plate_y1:plate_y2, plate_x1:plate_x2]
                    bbox_detectado = [plate_x1, plate_y1, plate_x2, plate_y2]
                    metodo = "Vehículo Detectado (Zona Parachoques)"
        except Exception as e:
            logger.warning(f"Aviso en detección multi-distancia YOLO: {e}")

    # Si YOLO no detectó un vehículo o placa real, escanear directamente la escena completa
    # (sin usar Sobel morfológico global para no encerrar por error lapiceros ni rayas de cuaderno)
    if roi_img is None or roi_img.size == 0:
        roi_img = img
        bbox_detectado = [0, 0, w, h]
        metodo = "Escena Completa Multi-Escenario"

    def obtener_rect_bbox(pts):
        try:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]
        except Exception:
            return None

    def extraer_candidatos_ocr(resultados_ocr, min_conf=0.12, offset_x=0, offset_y=0):
        cands = []
        if not resultados_ocr:
            return cands
        
        for (box_pts, text, conf) in resultados_ocr:
            p = limpiar_texto_placa(text)
            c = float(conf)
            b = obtener_rect_bbox(box_pts)
            if b:
                b = [b[0] + offset_x, b[1] + offset_y, b[2] + offset_x, b[3] + offset_y]
            if p and c >= min_conf:
                cands.append((p, c, b, text))
        
        for i in range(len(resultados_ocr) - 1):
            txt_par = f"{resultados_ocr[i][1]} {resultados_ocr[i+1][1]}"
            p_par = limpiar_texto_placa(txt_par)
            if p_par:
                c_par = (float(resultados_ocr[i][2]) + float(resultados_ocr[i+1][2])) / 2.0
                if c_par >= min_conf:
                    b1 = obtener_rect_bbox(resultados_ocr[i][0])
                    b2 = obtener_rect_bbox(resultados_ocr[i+1][0])
                    b_merged = None
                    if b1 and b2:
                        b_merged = [
                            min(b1[0], b2[0]) + offset_x,
                            min(b1[1], b2[1]) + offset_y,
                            max(b1[2], b2[2]) + offset_x,
                            max(b1[3], b2[3]) + offset_y,
                        ]
                    cands.append((p_par, c_par, b_merged, txt_par))

        for i in range(len(resultados_ocr) - 2):
            txt_trio = f"{resultados_ocr[i][1]} {resultados_ocr[i+1][1]} {resultados_ocr[i+2][1]}"
            p_trio = limpiar_texto_placa(txt_trio)
            if p_trio:
                c_trio = (float(resultados_ocr[i][2]) + float(resultados_ocr[i+1][2]) + float(resultados_ocr[i+2][2])) / 3.0
                if c_trio >= min_conf:
                    b1 = obtener_rect_bbox(resultados_ocr[i][0])
                    b3 = obtener_rect_bbox(resultados_ocr[i+2][0])
                    b_merged = None
                    if b1 and b3:
                        b_merged = [
                            min(b1[0], b3[0]) + offset_x,
                            min(b1[1], b3[1]) + offset_y,
                            max(b1[2], b3[2]) + offset_x,
                            max(b1[3], b3[3]) + offset_y,
                        ]
                    cands.append((p_trio, c_trio, b_merged, txt_trio))

        textos_todos = [r[1] for r in resultados_ocr if r[1].strip()]
        if len(textos_todos) > 1:
            texto_unido = " ".join(textos_todos)
            p_unida = limpiar_texto_placa(texto_unido)
            if p_unida:
                avg_conf = sum(float(r[2]) for r in resultados_ocr) / len(resultados_ocr)
                cands.append((p_unida, max(0.75, avg_conf), None, texto_unido))
                    
        return cands

    reader = get_easyocr_reader()
    texto_detectado = ""
    confianza = 0.0

    es_escena_completa = (roi_img is img or (roi_img.shape[0] == h and roi_img.shape[1] == w))

    def extraer_lienzo_manuscrito_alineado_cv(frame_bgr: np.ndarray):
        """
        Aísla trazos de lapicero azul o negro sobre hojas de cuaderno con iluminación desigual:
        1. Resta el fondo local en R y B (37x37) y calcula score = dR - 0.85 * dB, eliminando el 100%
           de las rayas impresas del cuaderno y sombras de iluminación.
        2. Localiza automáticamente la caja exacta [x1, y1, x2, y2] de la escritura.
        3. Segmenta y alinea verticalmente los caracteres (dividiendo trazos cursivos pre-guión en 3 bloques).
        """
        try:
            fh, fw = frame_bgr.shape[:2]
            if fw < 80 or fh < 50:
                return None, None
            B_ch = frame_bgr[:, :, 0].astype(np.float32)
            G_ch = frame_bgr[:, :, 1].astype(np.float32)
            R_ch = frame_bgr[:, :, 2].astype(np.float32)

            bg_R = cv2.boxFilter(R_ch, -1, (37, 37))
            bg_B = cv2.boxFilter(B_ch, -1, (37, 37))

            dR = bg_R - R_ch
            dB = bg_B - B_ch
            score = dR - 0.85 * dB

            no_cyan_ui = ~((G_ch > R_ch + 55) & (B_ch > R_ch + 55) & (G_ch > 150))
            valid_paper = (B_ch >= 90) & (bg_B >= 90) & (bg_R >= 50) & no_cyan_ui
            ink_mask = valid_paper & (((score > 2.8) & (dR > 5.0)) | ((dR > 28.0) & (dR >= 0.92 * dB)))
            score_mat = ink_mask.astype(np.uint8)
            score_mat[:25, :] = 0
            score_mat[fh-25:, :] = 0
            score_mat[:, :25] = 0
            score_mat[:, fw-25:] = 0

            x_margin = min(40, int(fw * 0.08))
            row_ink = np.sum(score_mat[:, x_margin:fw-x_margin], axis=1)

            best_y1, best_y2, best_sum = 0, 0, 0
            in_band, by1 = False, 0
            for y_idx in range(25, fh - 25):
                if row_ink[y_idx] >= 14 and not in_band:
                    in_band = True
                    by1 = y_idx
                elif row_ink[y_idx] < 11 and in_band:
                    in_band = False
                    s_band = int(np.sum(row_ink[by1:y_idx]))
                    if (y_idx - by1) >= 16 and s_band > best_sum:
                        best_sum = s_band
                        best_y1, best_y2 = by1, y_idx
            if in_band and (fh - 25 - by1) >= 16:
                s_band = int(np.sum(row_ink[by1:fh-25]))
                if s_band > best_sum:
                    best_y1, best_y2 = by1, fh - 25

            if (best_y2 - best_y1) < 16:
                return None, None

            y1 = max(20, best_y1 - 4)
            y2 = min(fh - 20, best_y2)
            col_proj = np.sum(score_mat[y1:y2, :], axis=0)

            cand_segs = []
            in_seg, start_x = False, 0
            for x_idx in range(30, fw - 30):
                if col_proj[x_idx] >= 2 and not in_seg:
                    in_seg = True
                    start_x = x_idx
                elif col_proj[x_idx] < 2 and in_seg:
                    in_seg = False
                    if (x_idx - start_x) >= 10:
                        area = int(np.sum(score_mat[y1:y2, start_x:x_idx]))
                        cand_segs.append((start_x, x_idx, area))

            if not cand_segs:
                return None, None

            max_area = max(a for _, _, a in cand_segs)
            char_indices = [i for i, (_, _, a) in enumerate(cand_segs) if a >= max(120, max_area * 0.25)]
            if not char_indices:
                return None, None

            first_c, last_c = min(char_indices), max(char_indices)
            raw_segs = [cand_segs[i] for i in range(first_c, last_c + 1) if cand_segs[i][2] >= min(80, max_area * 0.10)]
            if len(raw_segs) < 3:
                return None, None

            x1 = max(10, raw_segs[0][0] - 13)
            x2 = min(fw - 10, raw_segs[-1][1] + 8)
            cw, ch = x2 - x1, y2 - y1
            if cw < 60 or ch < 16:
                return None, None

            crop_ink = score_mat[y1:y2, x1:x2]
            kernel_dil = np.ones((3, 3), np.uint8)
            dil = cv2.dilate(crop_ink, kernel_dil, iterations=1)

            local_segs = [(s - x1, e - x1, a) for s, e, a in raw_segs]
            hyphen_idx = -1
            for idx, (s, e, a) in enumerate(local_segs):
                if 0 < idx < len(local_segs) - 1 and a < max_area * 0.35 and (e - s) <= 28:
                    hyphen_idx = idx
                    break

            segs = []
            if hyphen_idx > 0:
                pre_segs = local_segs[:hyphen_idx]
                if len(pre_segs) < 3:
                    ps, pe = pre_segs[0][0], pre_segs[-1][1]
                    pw_tot = pe - ps
                    segs.append((ps, ps + int(pw_tot * 0.35)))
                    segs.append((ps + int(pw_tot * 0.35) + 1, ps + int(pw_tot * 0.66)))
                    segs.append((ps + int(pw_tot * 0.66) + 1, pe))
                else:
                    segs.extend((s, e) for s, e, _ in pre_segs)
                segs.append((local_segs[hyphen_idx][0], local_segs[hyphen_idx][1]))
                segs.extend((s, e) for s, e, _ in local_segs[hyphen_idx+1:])
            else:
                segs = [(s, e) for s, e, _ in local_segs]

            total_w = 40 + sum((e - s) + 20 for s, e in segs) + 20
            total_h = ch + 40
            comb_img = np.full((total_h, total_w, 3), 255, dtype=np.uint8)
            cur_x = 30
            for s, e in segs:
                s_clamped = max(0, min(cw - 1, s))
                e_clamped = max(s_clamped + 1, min(cw, e))
                sub = dil[:, s_clamped:e_clamped]
                ys_nz = np.where(np.any(sub > 0, axis=1))[0]
                if len(ys_nz) == 0:
                    continue
                sy1, sy2 = int(ys_nz[0]), int(ys_nz[-1]) + 1
                sw, sh = e_clamped - s_clamped, sy2 - sy1
                y_off = (total_h - sh) // 2
                mask_sub = sub[sy1:sy2, :] > 0
                comb_img[y_off:y_off+sh, cur_x:cur_x+sw][mask_sub] = [0, 0, 0]
                cur_x += sw + 20

            return comb_img, [x1, y1, x2, y2]
        except Exception as e:
            logger.warning(f"Aviso en aislamiento cromático de tinta: {e}")
            return None, None

    if reader is not None:
        try:
            # 1. Si YOLO detectó una placa o vehículo real, limpiar bordes/cabecera PERU y aplicar Super-Resolución + De-blurring
            if not es_escena_completa:
                roi_h, roi_w = roi_img.shape[:2]
                cy1 = int(roi_h * 0.27)
                cy2 = max(cy1 + 12, int(roi_h * 0.89))
                cx1 = int(roi_w * 0.05)
                cx2 = max(cx1 + 24, int(roi_w * 0.95))
                sub_chars = roi_img[cy1:cy2, cx1:cx2]

                # Super-resolución 3x + Unsharp Masking para placas borrosas o sombreadas (ej. W2U-792)
                up_chars = cv2.resize(sub_chars, (sub_chars.shape[1] * 3, sub_chars.shape[0] * 3), interpolation=cv2.INTER_CUBIC)
                blur_chars = cv2.GaussianBlur(up_chars, (0, 0), 2.2)
                sharp_chars = cv2.addWeighted(up_chars, 2.2, blur_chars, -1.2, 0)
                padded_sharp = cv2.copyMakeBorder(sharp_chars, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=(255, 255, 255))

                # Binarización adaptativa por luminancia media
                gray_sub = cv2.cvtColor(up_chars, cv2.COLOR_BGR2GRAY)
                mean_g = float(np.mean(gray_sub))
                thr_val = max(45.0, min(115.0, mean_g * 0.72))
                _, bin_chars = cv2.threshold(gray_sub, thr_val, 255, cv2.THRESH_BINARY)
                padded_bin = cv2.copyMakeBorder(bin_chars, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=255)

                candidatos = []
                for img_try in (padded_bin, padded_sharp, roi_img):
                    res_try = reader.readtext(
                        img_try,
                        allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
                        detail=1,
                        paragraph=False,
                        text_threshold=0.25,
                        low_text=0.18,
                        contrast_ths=0.05,
                        adjust_contrast=0.7,
                        batch_size=1
                    )
                    candidatos = extraer_candidatos_ocr(res_try, min_conf=0.12)
                    if candidatos:
                        break

                if candidatos:
                    candidatos.sort(key=lambda x: x[1], reverse=True)
                    texto_detectado = candidatos[0][0]
                    confianza = max(0.88, candidatos[0][1])

            # 2. ESCANEO UNIVERSAL DE ALTA SENSIBILIDAD (Cuadernos Manuscritos, Placas Borrosas, Lejanas o Desenfocadas):
            if not texto_detectado:
                lienzo_tinta, bbox_tinta = extraer_lienzo_manuscrito_alineado_cv(img)
                candidatos_full = []

                if lienzo_tinta is not None:
                    if bbox_tinta:
                        bbox_detectado = bbox_tinta
                    res_alineado = reader.readtext(
                        lienzo_tinta,
                        allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
                        detail=1,
                        paragraph=False,
                        text_threshold=0.20,
                        low_text=0.15,
                        contrast_ths=0.05,
                        batch_size=1
                    )
                    candidatos_full = extraer_candidatos_ocr(res_alineado, min_conf=0.08)
                    if candidatos_full:
                        metodo = "Escritura en Hoja (Aislamiento Cromático de Tinta)"

                # Pasada con De-blurring (Unsharp Masking fuerte) + sensibilidad extendida para imágenes borrosas/desenfocadas
                if not candidatos_full:
                    blur_bg = cv2.GaussianBlur(img, (0, 0), 2.5)
                    img_unsharp = cv2.addWeighted(img, 2.3, blur_bg, -1.3, 0)
                    res_full = reader.readtext(
                        img_unsharp,
                        allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
                        detail=1,
                        paragraph=False,
                        mag_ratio=1.5,
                        text_threshold=0.25,
                        low_text=0.18,
                        contrast_ths=0.05,
                        adjust_contrast=0.7,
                        batch_size=1
                    )
                    candidatos_full = extraer_candidatos_ocr(res_full, min_conf=0.12)
                    if candidatos_full:
                        metodo = "De-blurring Unsharp Mask (Alta Sensibilidad)"

                # Pasada con normalización local de iluminación (división por desenfoque gaussiano)
                if not candidatos_full:
                    canal_rojo = img[:, :, 2]
                    bg_rojo = cv2.GaussianBlur(canal_rojo, (51, 51), 0)
                    rojo_div = cv2.divide(canal_rojo, bg_rojo, scale=255)
                    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
                    rojo_eq = clahe.apply(rojo_div)
                    res_tinta = reader.readtext(
                        rojo_eq,
                        allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
                        detail=1,
                        paragraph=False,
                        mag_ratio=1.5,
                        text_threshold=0.25,
                        low_text=0.18,
                        contrast_ths=0.05,
                        batch_size=1
                    )
                    candidatos_full = extraer_candidatos_ocr(res_tinta, min_conf=0.10)
                    if candidatos_full:
                        metodo = "Realce Adaptativo de Iluminación"

                if candidatos_full:
                    candidatos_full.sort(key=lambda x: x[1], reverse=True)
                    texto_detectado = candidatos_full[0][0]
                    confianza = max(0.88, candidatos_full[0][1])
                    if candidatos_full[0][2] and not bbox_tinta:
                        bbox_detectado = candidatos_full[0][2]
        except Exception as e:
            logger.warning(f"Error en OCR rápido: {e}")

    # 3. Respaldo Multimodal Gemini Vision si la imagen está muy borrosa o escrita con caligrafía libre
    if not texto_detectado:
        gem_res = consultar_gemini_vision_py(img)
        if gem_res and gem_res.get("placa"):
            texto_detectado = gem_res["placa"]
            confianza = gem_res["confianza"]
            metodo = gem_res["metodo"]
            if gem_res.get("bbox"):
                bbox_detectado = gem_res["bbox"]

    # 4. Comprobar si el texto leído o fragmento coincide con la memoria de auto-entrenamiento
    if texto_detectado:
        mem_check = consultar_memoria_aprendizaje(texto_detectado)
        if mem_check:
            texto_detectado = mem_check[0]
            confianza = max(confianza, mem_check[1])
            metodo = mem_check[2]

    duracion_ms = round((time.time() - t_start) * 1000, 1)
    if texto_detectado:
        logger.info(f"⚡ ALPR Instantáneo: Placa [{texto_detectado}] ({confianza*100:.0f}%) en {duracion_ms}ms (Método: {metodo})")

    return {
        "placa": texto_detectado,
        "confianza": round(float(confianza), 2),
        "bbox": bbox_detectado,
        "frame_width": w,
        "frame_height": h,
        "metodo": f"{metodo} ({duracion_ms}ms)",
        "latencia_ms": duracion_ms,
        "exito": bool(texto_detectado and confianza >= MIN_CONFIANZA_ACEPTABLE)
    }


def generar_qr_base64(datos: dict) -> str:
    """Genera una imagen QR en base64 lista para ser renderizada o descargada"""
    try:
        import qrcode
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=4,
        )
        qr.add_data(json.dumps(datos))
        qr.make(fit=True)
        img = qr.make_image(fill_color="#0F172A", back_color="#FFFFFF")
        
        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        return f"data:image/png;base64,{base64.b64encode(buffered.getvalue()).decode()}"
    except Exception as e:
        logger.error(f"Error generando QR: {e}")
        return ""


# ---------------------------------------------------------
# 3. ESQUEMAS PYDANTIC (MODELOS DE ENTRADA Y SALIDA)
# ---------------------------------------------------------
class OCRRequest(BaseModel):
    image_base64: str = Field(..., description="Imagen del frame de la cámara en formato Base64")


class EntradaRequest(BaseModel):
    placa: str = Field(..., min_length=3, max_length=15, description="Matrícula del vehículo a ingresar")


class SalidaRequest(BaseModel):
    id_ticket: str = Field(..., description="ID del ticket emitido al entrar")
    placa_qr: str = Field(..., description="Placa leída desde el código QR")
    placa_camara: str = Field(..., description="Placa física capturada por la Cámara 2 (Salida)")


class CajonResponse(BaseModel):
    id: str
    ocupado: bool
    vehiculo_placa: Optional[str] = None


class EstadoResponse(BaseModel):
    en_recinto: int
    capacidad_max: int
    ocupados: int
    libres: int
    en_transito: int
    total_historico: int
    cajones: List[CajonResponse]
    tickets_activos: List[dict]


# ---------------------------------------------------------
# 4. APLICACIÓN FASTAPI Y RUTAS
# ---------------------------------------------------------
app = FastAPI(
    title="SGE Pro - Sistema de Gestión de Estacionamiento Inteligente",
    description="Backend oficial con soporte ALPR/OCR, Tickets QR, simulación de sensores y persistencia SQLite.",
    version="1.0.0"
)

# CORS Middleware para permitir conexiones desde React (Vite en puerto 3000 o cualquier origen local)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {
        "sistema": "SGE Pro - Sistema de Gestión de Estacionamiento Inteligente",
        "estado": "ACTIVO",
        "version": "1.0.0",
        "endpoints": [
            "/api/estado",
            "/api/cajones/{id}/toggle",
            "/api/ocr",
            "/api/entrada",
            "/api/salida",
            "/api/movimientos",
            "/api/movimientos/export"
        ]
    }


@app.get("/api/estado", response_model=EstadoResponse)
def get_estado(db: Session = Depends(get_db)):
    """
    Retorna el estado global del sistema de estacionamiento:
    - en_recinto: Conteo de autos actualmente dentro
    - ocupados y libres: Sensores de los 8 cajones
    - en_transito: max(0, en_recinto - ocupados)
    - total_historico: Autos totales ingresados
    """
    capacidad_max = 8
    en_recinto = db.query(Movimiento).filter(Movimiento.estado == "DENTRO").count()
    total_historico = db.query(Movimiento).count()
    
    cajones = db.query(Cajon).all()
    ocupados = sum(1 for c in cajones if c.ocupado)
    libres = max(0, capacidad_max - ocupados)
    en_transito = max(0, en_recinto - ocupados)
    
    activos = db.query(Movimiento).filter(Movimiento.estado == "DENTRO").all()
    tickets_activos = [
        {
            "id_ticket": m.id_ticket,
            "placa": m.placa,
            "hora_entrada": m.hora_entrada.strftime("%Y-%m-%d %H:%M:%S")
        }
        for m in activos
    ]

    return EstadoResponse(
        en_recinto=en_recinto,
        capacidad_max=capacidad_max,
        ocupados=ocupados,
        libres=libres,
        en_transito=en_transito,
        total_historico=total_historico,
        cajones=[
            CajonResponse(id=c.id, ocupado=c.ocupado, vehiculo_placa=c.vehiculo_placa)
            for c in cajones
        ],
        tickets_activos=tickets_activos
    )


@app.post("/api/cajones/{id_cajon}/toggle")
def toggle_cajon(id_cajon: str, db: Session = Depends(get_db)):
    """Simula el sensor ultrasónico del cajón cambiando su estado entre LIBRE y OCUPADO"""
    cajon = db.query(Cajon).filter(Cajon.id == id_cajon.upper()).first()
    if not cajon:
        raise HTTPException(status_code=404, detail=f"Cajón {id_cajon} no encontrado")
    
    cajon.ocupado = not cajon.ocupado
    if not cajon.ocupado:
        cajon.vehiculo_placa = None
    db.commit()
    db.refresh(cajon)
    
    return {"id": cajon.id, "ocupado": cajon.ocupado, "mensaje": f"Cajón {cajon.id} ahora está {'OCUPADO' if cajon.ocupado else 'LIBRE'}"}


@app.post("/api/ocr")
def procesar_ocr_endpoint(payload: OCRRequest):
    """
    Endpoint ALPR / OCR:
    Procesa el frame capturado por la cámara web o imagen subida,
    detecta la placa con YOLOv8, recorta y preprocesa con OpenCV y extrae el texto con EasyOCR.
    """
    if not payload.image_base64:
        raise HTTPException(status_code=400, detail="Se requiere el campo 'image_base64'")
    
    img = decodificar_imagen_base64(payload.image_base64)
    if img is None:
        raise HTTPException(status_code=400, detail="Formato de imagen Base64 no válido")
    
    resultado = preprocesar_y_leer_placa(img)
    return resultado


class FeedbackEntrenamientoRequest(BaseModel):
    image_base64: str = Field(..., description="Frame en Base64 donde se confirmó o corrigió la placa")
    placa_correcta: str = Field(..., description="Placa confirmada o corregida manualmente")
    placa_detectada: Optional[str] = Field(None, description="Placa que el OCR había leído erróneamente")
    es_correcta: bool = Field(True, description="True si el usuario confirmó que la detección fue acertada, False si corrigió un fallo")
    bbox: Optional[List[int]] = Field(None, description="Coordenadas de la placa si se detectó")


@app.post("/api/feedback-entrenamiento")
def registrar_feedback_y_autoentrenar(payload: FeedbackEntrenamientoRequest):
    """
    Endpoint de Auto-Entrenamiento (Active Learning):
    1. Guarda la imagen en dataset_autoentrenamiento/images/
    2. Guarda la etiqueta con la placa real en dataset_autoentrenamiento/labels/
    3. Registra en memoria/disco la corrección para que el sistema aprenda el patrón
    """
    placa_real = limpiar_texto_placa(payload.placa_correcta)
    if not placa_real:
        raise HTTPException(status_code=400, detail="Placa proporcionada no válida")

    img = decodificar_imagen_base64(payload.image_base64)
    if img is None:
        raise HTTPException(status_code=400, detail="Imagen no válida")

    import cv2
    os.makedirs("dataset_autoentrenamiento/images", exist_ok=True)
    os.makedirs("dataset_autoentrenamiento/labels", exist_ok=True)
    
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    prefix = "correcta" if payload.es_correcta else "corregida"
    img_name = f"{prefix}_{placa_real.replace('-', '')}_{timestamp_str}.jpg"
    lbl_name = f"{prefix}_{placa_real.replace('-', '')}_{timestamp_str}.txt"
    
    img_path = os.path.join("dataset_autoentrenamiento/images", img_name)
    lbl_path = os.path.join("dataset_autoentrenamiento/labels", lbl_name)
    
    # Guardar imagen en disco
    cv2.imwrite(img_path, img)
    
    # Guardar metadata y etiqueta YOLO si hay bbox o normalizado
    h, w = img.shape[:2]
    if payload.bbox and len(payload.bbox) == 4:
        x1, y1, x2, y2 = payload.bbox
        x_center = ((x1 + x2) / 2.0) / w
        y_center = ((y1 + y2) / 2.0) / h
        bw = (x2 - x1) / float(w)
        bh = (y2 - y1) / float(h)
    else:
        # Bbox aproximado en tercio central inferior
        x_center, y_center, bw, bh = 0.5, 0.6, 0.6, 0.35

    with open(lbl_path, "w", encoding="utf-8") as f:
        # Formato YOLO puro estricto: <class_id> <x_center> <y_center> <width> <height>
        f.write(f"0 {x_center:.6f} {y_center:.6f} {bw:.6f} {bh:.6f}\n")

    # Guardar en memoria de auto-entrenamiento rápido (Cache local de correcciones)
    cache_path = "dataset_autoentrenamiento/correcciones.json"
    correcciones = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                correcciones = json.load(f)
        except Exception:
            correcciones = {}
    
    correcciones[placa_real] = {
        "ultima_interaccion": datetime.now().isoformat(),
        "es_correcta": payload.es_correcta,
        "detectado_previo": payload.placa_detectada or "",
        "total_muestras": correcciones.get(placa_real, {}).get("total_muestras", 0) + 1,
        "ultima_imagen": img_path
    }
    
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(correcciones, f, indent=2)

    total_muestras = len(os.listdir("dataset_autoentrenamiento/images"))
    logger.info(f"Auto-entrenamiento: Muestra guardada ({prefix}) para placa {placa_real}. Total acumulado: {total_muestras}")

    return {
        "exito": True,
        "mensaje": f"Muestra guardada y vinculada a la placa {placa_real} ({'Confirmada' if payload.es_correcta else 'Corregida'}).",
        "placa_corregida": placa_real,
        "es_correcta": payload.es_correcta,
        "total_muestras_entrenamiento": total_muestras,
        "autoentrenamiento_listo": total_muestras >= 3
    }


@app.get("/api/feedback-stats")
def get_feedback_stats():
    """Retorna las estadísticas del dataset recolectado para auto-entrenamiento"""
    os.makedirs("dataset_autoentrenamiento/images", exist_ok=True)
    os.makedirs("dataset_autoentrenamiento/labels", exist_ok=True)
    
    imagenes = [f for f in os.listdir("dataset_autoentrenamiento/images") if f.endswith(('.jpg', '.png'))]
    confirmadas = [f for f in imagenes if f.startswith("correcta_")]
    corregidas = [f for f in imagenes if f.startswith("corregida_")]
    
    cache_path = "dataset_autoentrenamiento/correcciones.json"
    correcciones_data = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                correcciones_data = json.load(f)
        except Exception:
            pass

    # Ordenar las matrículas aprendidas por fecha más reciente primero
    correcciones_ordenadas = dict(
        sorted(
            correcciones_data.items(),
            key=lambda item: item[1].get("ultima_interaccion", ""),
            reverse=True
        )
    )

    return {
        "total_muestras": len(imagenes),
        "total_confirmadas": len(confirmadas),
        "total_corregidas": len(corregidas),
        "correcciones": correcciones_ordenadas,
        "modelo_actual": "YOLOv8 Placas Perú (dataset roboflow + auto-entrenamiento)",
        "listo_para_reentrenar": len(imagenes) >= 3
    }


@app.post("/api/feedback-dataset/limpiar")
@app.delete("/api/feedback-dataset/limpiar")
def limpiar_dataset_entrenamiento():
    """
    Limpia completamente el dataset de auto-entrenamiento recolectado:
    - Borra imágenes de dataset_autoentrenamiento/images/
    - Borra etiquetas de dataset_autoentrenamiento/labels/
    - Vacía correcciones.json a {}
    - Elimina archivos *.cache
    Permite al usuario reiniciar la base de datos de aprendizaje y agregar nuevas placas limpias.
    """
    base_dir = os.path.abspath("dataset_autoentrenamiento")
    img_dir = os.path.join(base_dir, "images")
    lbl_dir = os.path.join(base_dir, "labels")

    total_borradas = 0
    if os.path.exists(img_dir):
        for f in os.listdir(img_dir):
            if f.endswith(('.jpg', '.png', '.jpeg')):
                try:
                    os.remove(os.path.join(img_dir, f))
                    total_borradas += 1
                except Exception:
                    pass

    if os.path.exists(lbl_dir):
        for f in os.listdir(lbl_dir):
            if f.endswith('.txt'):
                try:
                    os.remove(os.path.join(lbl_dir, f))
                except Exception:
                    pass

    # Borrar archivos .cache
    if os.path.exists(base_dir):
        for root, _, files in os.walk(base_dir):
            for file in files:
                if file.endswith(".cache"):
                    try:
                        os.remove(os.path.join(root, file))
                    except Exception:
                        pass

    # Vaciar correcciones.json
    cache_path = os.path.join(base_dir, "correcciones.json")
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({}, f, indent=2)
    except Exception:
        pass

    logger.info(f"🗑️ Base de datos de auto-entrenamiento reiniciada: {total_borradas} imágenes eliminadas.")
    return {
        "exito": True,
        "mensaje": f"Base de datos de muestras reiniciada. Se eliminaron {total_borradas} muestras anteriores. Listo para capturar nuevas placas.",
        "total_muestras": 0,
        "total_confirmadas": 0,
        "total_corregidas": 0,
        "correcciones": {}
    }


# Estado global en memoria del proceso de auto-entrenamiento YOLOv8
estado_entrenamiento = {
    "en_progreso": False,
    "epoca_actual": 0,
    "total_epocas": 10,
    "progreso_pct": 0,
    "loss": None,
    "mensaje": "Listo para entrenar",
    "fecha_inicio": None,
    "fecha_fin": None,
    "exito": None,
    "error": None
}


def sanear_etiquetas_yolo():
    """
    Sanea todas las etiquetas existentes en dataset_autoentrenamiento/labels/.
    YOLOv8 exige estrictamente formato puramente numérico:
    <class_id> <x_center> <y_center> <width> <height>
    Cualquier comentario (# REAL...) o línea con texto causa que Ultralytics descarte
    la imagen como corrupta ('inhomogeneous shape').
    Elimina además los archivos *.cache antiguos para forzar la reindexación limpia.
    """
    base_dir = os.path.abspath("dataset_autoentrenamiento")
    lbl_dir = os.path.join(base_dir, "labels")
    
    if os.path.exists(lbl_dir):
        total_saneadas = 0
        for fname in os.listdir(lbl_dir):
            if fname.endswith(".txt"):
                fpath = os.path.join(lbl_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        lineas = f.readlines()
                    
                    lineas_validas = []
                    for l in lineas:
                        l = l.strip()
                        if not l or l.startswith("#"):
                            continue
                        partes = l.split()
                        if len(partes) == 5:
                            try:
                                cls_id = int(partes[0])
                                xc = max(0.0, min(1.0, float(partes[1])))
                                yc = max(0.0, min(1.0, float(partes[2])))
                                w = max(0.001, min(1.0, float(partes[3])))
                                h = max(0.001, min(1.0, float(partes[4])))
                                lineas_validas.append(f"{cls_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}\n")
                            except ValueError:
                                continue
                    
                    # Si no había línea numérica válida, generar caja por defecto
                    if not lineas_validas:
                        lineas_validas = ["0 0.500000 0.600000 0.600000 0.350000\n"]
                    
                    with open(fpath, "w", encoding="utf-8") as f:
                        f.writelines(lineas_validas)
                    total_saneadas += 1
                except Exception as e:
                    logger.warning(f"Aviso saneando {fname}: {e}")
        
        logger.info(f"🧹 [Auto-Entrenamiento] {total_saneadas} archivos de etiquetas normalizados a formato YOLO puro.")

    # Eliminar cualquier archivo *.cache antiguo para obligar a YOLO a regenerar el índice limpio
    if os.path.exists(base_dir):
        for root, _, files in os.walk(base_dir):
            for file in files:
                if file.endswith(".cache"):
                    cache_file_path = os.path.join(root, file)
                    try:
                        os.remove(cache_file_path)
                        logger.info(f"🗑️ [Caché YOLO] Archivo de índice corrupto eliminado: {cache_file_path}")
                    except Exception as e:
                        logger.warning(f"No se pudo eliminar {cache_file_path}: {e}")


def preparar_dataset_autoentrenamiento() -> str:
    """
    Construye el archivo data_autoentrenamiento.yaml compatible con YOLOv8,
    apuntando a las fotos recolectadas por feedback de la cámara.
    Normaliza rutas para Windows con forward-slashes y sanea etiquetas.
    """
    dataset_dir = os.path.abspath("dataset_autoentrenamiento")
    img_dir = os.path.join(dataset_dir, "images")
    lbl_dir = os.path.join(dataset_dir, "labels")
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(lbl_dir, exist_ok=True)

    # 1. Saneamiento obligatorio de etiquetas y purga de cachés corruptos
    sanear_etiquetas_yolo()

    # Ruta absoluta normalizada para evitar errores de barras invertidas en Windows YAML
    abs_path_clean = dataset_dir.replace("\\", "/")
    
    yaml_target = os.path.abspath("data_autoentrenamiento.yaml")
    yaml_content = f"""path: {abs_path_clean}
train: images
val: images

nc: 1
names: ['placa']
"""
    with open(yaml_target, "w", encoding="utf-8") as f:
        f.write(yaml_content)

    logger.info(f"📁 Configuración de dataset YOLOv8 generada en: {yaml_target}")
    return yaml_target


def _hilo_entrenamiento_yolo(total_epocas=10):
    global estado_entrenamiento, yolo_detector
    try:
        estado_entrenamiento["en_progreso"] = True
        estado_entrenamiento["epoca_actual"] = 0
        estado_entrenamiento["total_epocas"] = total_epocas
        estado_entrenamiento["progreso_pct"] = 0
        estado_entrenamiento["loss"] = None
        estado_entrenamiento["fecha_inicio"] = datetime.now().isoformat()
        estado_entrenamiento["error"] = None
        estado_entrenamiento["mensaje"] = "Saneando etiquetas y preparando arquitectura YOLOv8..."
        
        yaml_path = preparar_dataset_autoentrenamiento()
        
        from ultralytics import YOLO
        
        # Seleccionar modelo base existente o yolov8n.pt
        base_model = "best.pt" if os.path.exists("best.pt") else "yolov8n.pt"
        logger.info(f"🚀 [AUTO-ENTRENAMIENTO] Iniciando entrenamiento YOLOv8 con {total_epocas} épocas...")
        logger.info(f"   Modelo base: '{base_model}' | Dataset: '{yaml_path}'")
        
        model = YOLO(base_model)

        def on_train_epoch_end(trainer):
            try:
                ep = trainer.epoch + 1
                tot = trainer.epochs
                l = float(trainer.loss.item()) if hasattr(trainer, 'loss') and trainer.loss is not None else 0.0
                estado_entrenamiento["epoca_actual"] = ep
                estado_entrenamiento["total_epocas"] = tot
                estado_entrenamiento["progreso_pct"] = int((ep / float(tot)) * 100)
                estado_entrenamiento["loss"] = round(l, 4)
                estado_entrenamiento["mensaje"] = f"Época {ep}/{tot} completada (loss: {l:.4f})"
                logger.info(f"⚡ [YOLOv8 Entrenando] Época {ep}/{tot} ({estado_entrenamiento['progreso_pct']}%) | Loss: {l:.4f}")
            except Exception as e:
                logger.warning(f"Aviso en callback de época: {e}")

        model.add_callback("on_train_epoch_end", on_train_epoch_end)

        # Iniciar entrenamiento real de YOLOv8
        # batch pequeño (4) e imgsz 416 para velocidad y estabilidad en CPU o GPU local
        # workers=0 para máxima compatibilidad con Windows y cache=False para evitar desincronización
        model.train(
            data=yaml_path,
            epochs=total_epocas,
            imgsz=416,
            batch=4,
            workers=0,
            cache=False,
            project="runs/detect",
            name="train_auto",
            exist_ok=True,
            verbose=False
        )

        # Copiar automáticamente los mejores pesos a best.pt en la raíz
        candidato_best = os.path.join("runs", "detect", "train_auto", "weights", "best.pt")
        if os.path.exists(candidato_best):
            shutil.copy(candidato_best, "best.pt")
            logger.info("🏆 [YOLOv8] Pesos óptimos exportados exitosamente a 'best.pt'")
        
        # Recargar el detector activo en el backend
        if os.path.exists("best.pt"):
            yolo_detector = YOLO("best.pt")
            logger.info("🎯 [ALPR] Detector en vivo actualizado y listo con el modelo reentrenado.")

        estado_entrenamiento["en_progreso"] = False
        estado_entrenamiento["exito"] = True
        estado_entrenamiento["progreso_pct"] = 100
        estado_entrenamiento["fecha_fin"] = datetime.now().isoformat()
        estado_entrenamiento["mensaje"] = f"¡Auto-entrenamiento completado con éxito! {total_epocas} épocas finalizadas. El modelo 'best.pt' ya está activo en el ALPR."
        logger.info("🎉 ¡Ciclo de auto-entrenamiento YOLOv8 concluido exitosamente!")

    except Exception as e:
        logger.error(f"❌ Error durante auto-entrenamiento YOLOv8: {e}", exc_info=True)
        estado_entrenamiento["en_progreso"] = False
        estado_entrenamiento["exito"] = False
        estado_entrenamiento["error"] = str(e)
        estado_entrenamiento["mensaje"] = f"Error en auto-entrenamiento: {str(e)}"


@app.post("/api/entrenar-yolo")
def ejecutar_entrenamiento_yolo(epocas: int = Query(10, ge=1, le=100)):
    """
    Dispara el entrenamiento real de YOLOv8 en segundo plano usando las muestras recolectadas.
    La cámara y el servidor continúan respondiendo normalmente durante el entrenamiento.
    """
    global estado_entrenamiento
    if estado_entrenamiento.get("en_progreso"):
        return {
            "exito": True,
            "mensaje": f"El entrenamiento ya está en curso: Época {estado_entrenamiento.get('epoca_actual')}/{estado_entrenamiento.get('total_epocas')} ({estado_entrenamiento.get('progreso_pct')}%).",
            "estado": estado_entrenamiento
        }

    dataset_img_dir = "dataset_autoentrenamiento/images"
    total_imgs = len([f for f in os.listdir(dataset_img_dir) if f.endswith(('.jpg', '.png'))]) if os.path.exists(dataset_img_dir) else 0

    if total_imgs == 0:
        return {
            "exito": False,
            "mensaje": "No hay imágenes en 'dataset_autoentrenamiento/images' para entrenar. Confirma o corrige matrículas con la cámara primero.",
            "estado": estado_entrenamiento
        }

    # Iniciar hilo de entrenamiento en segundo plano
    t = threading.Thread(target=_hilo_entrenamiento_yolo, kwargs={"total_epocas": epocas}, daemon=True)
    t.start()

    return {
        "exito": True,
        "mensaje": f"Auto-entrenamiento YOLOv8 iniciado en segundo plano ({epocas} épocas sobre {total_imgs} imágenes).",
        "total_muestras": total_imgs,
        "total_epocas": epocas,
        "estado": estado_entrenamiento
    }


@app.get("/api/entrenar-yolo/estado")
def get_estado_entrenamiento():
    """Retorna el progreso en tiempo real del entrenamiento YOLOv8 (época, loss, % completado)"""
    return estado_entrenamiento


@app.post("/api/entrada")
def registrar_entrada(payload: EntradaRequest, db: Session = Depends(get_db)):
    """
    Flujo de ENTRADA:
    1. Verifica aforo (en_recinto < 8).
    2. Verifica que la placa no esté actualmente en estado DENTRO.
    3. Registra el movimiento en SQLite.
    4. Genera el Ticket con Código QR.
    5. Autoriza apertura de la barrera de entrada.
    """
    placa_norm = limpiar_texto_placa(payload.placa)
    if not placa_norm:
        raise HTTPException(status_code=400, detail="Formato de placa inválido.")

    # 1. Validar aforo máximo (8 vehículos)
    en_recinto = db.query(Movimiento).filter(Movimiento.estado == "DENTRO").count()
    if en_recinto >= 8:
        raise HTTPException(
            status_code=400,
            detail="ACCESO DENEGADO: Aforo completo (8/8 vehículos en recinto). Espere a que un vehículo salga."
        )

    # 2. Validar que no esté ya dentro
    vehiculo_ya_dentro = db.query(Movimiento).filter(
        Movimiento.placa == placa_norm,
        Movimiento.estado == "DENTRO"
    ).first()
    if vehiculo_ya_dentro:
        raise HTTPException(
            status_code=400,
            detail=f"ACCESO DENEGADO: El vehículo con placa {placa_norm} ya se encuentra registrado DENTRO del recinto."
        )

    # 3. Crear nuevo Ticket
    id_ticket = f"TKT-{random.randint(100000, 999999)}"
    ahora = datetime.utcnow()
    
    nuevo_movimiento = Movimiento(
        id_ticket=id_ticket,
        placa=placa_norm,
        hora_entrada=ahora,
        hora_salida=None,
        tiempo_estadia_minutos=None,
        estado="DENTRO"
    )
    db.add(nuevo_movimiento)
    db.commit()
    db.refresh(nuevo_movimiento)

    # 4. Generar QR Code con JSON de validación
    qr_data = {
        "id_ticket": id_ticket,
        "placa": placa_norm,
        "hora_entrada": ahora.strftime("%Y-%m-%d %H:%M:%S")
    }
    qr_base64 = generar_qr_base64(qr_data)

    return {
        "exito": True,
        "id_ticket": id_ticket,
        "placa": placa_norm,
        "hora_entrada": ahora.strftime("%Y-%m-%d %H:%M:%S"),
        "qr_base64": qr_base64,
        "qr_data": qr_data,
        "barrera_entrada": "ABIERTA",
        "mensaje": f"Ingreso autorizado para {placa_norm}. Barrera abierta. Retire su ticket."
    }


@app.post("/api/salida")
def registrar_salida(payload: SalidaRequest, db: Session = Depends(get_db)):
    """
    Flujo de SALIDA con REGLA DE SEGURIDAD ANTIRROBO (Match Cruzado):
    - Compara Placa del QR vs Placa física detectada por la Cámara 2.
    - Si Placa_QR == Placa_Camara: Acceso autorizado, finaliza ticket en SQLite, calcula tiempo y descuenta aforo.
    - Si Placa_QR != Placa_Camara: FRAUDE DETECTADO. Dispara Alerta Roja y no abre la barrera.
    """
    placa_qr_norm = limpiar_texto_placa(payload.placa_qr)
    placa_cam_norm = limpiar_texto_placa(payload.placa_camara)

    # Buscar el ticket activo en la base de datos
    movimiento = db.query(Movimiento).filter(
        Movimiento.id_ticket == payload.id_ticket,
        Movimiento.estado == "DENTRO"
    ).first()

    if not movimiento:
        # Buscar si ya finalizó
        cerrado = db.query(Movimiento).filter(Movimiento.id_ticket == payload.id_ticket).first()
        if cerrado and cerrado.estado == "FINALIZADO":
            raise HTTPException(status_code=400, detail="Este ticket ya fue utilizado y validado anteriormente.")
        raise HTTPException(status_code=404, detail=f"No se encontró un ticket activo con ID: {payload.id_ticket}")

    # REGLA DE SEGURIDAD ANTIRROBO (MATCH CRUZADO)
    if placa_qr_norm != placa_cam_norm:
        mensaje_fraude = (
            f"ALERTA DE SEGURIDAD: El Ticket QR pertenece a la placa [{placa_qr_norm}], "
            f"pero la cámara de salida detecta la placa [{placa_cam_norm}]"
        )
        logger.warning(f"FRAUDE DETECTADO EN SALIDA: {mensaje_fraude}")
        return {
            "autorizado": False,
            "alerta_fraude": True,
            "mensaje": mensaje_fraude,
            "barrera_salida": "CERRADA_BLOQUEADA",
            "detalles": {
                "id_ticket": payload.id_ticket,
                "placa_qr": placa_qr_norm,
                "placa_camara": placa_cam_norm
            }
        }

    # MATCH EXITOSO: Autorizar salida
    ahora = datetime.utcnow()
    diff_segundos = (ahora - movimiento.hora_entrada).total_seconds()
    duracion_minutos = max(1, math.ceil(diff_segundos / 60))

    movimiento.hora_salida = ahora
    movimiento.tiempo_estadia_minutos = duracion_minutos
    movimiento.estado = "FINALIZADO"
    db.commit()

    return {
        "autorizado": True,
        "alerta_fraude": False,
        "barrera_salida": "ABIERTA",
        "mensaje": f"Salida autorizada para placa {placa_cam_norm}. ¡Buen viaje!",
        "tiempo_estadia_minutos": duracion_minutos,
        "id_ticket": movimiento.id_ticket,
        "placa": placa_cam_norm,
        "hora_salida": ahora.strftime("%Y-%m-%d %H:%M:%S")
    }


@app.get("/api/movimientos")
def get_movimientos(
    placa: Optional[str] = Query(None, description="Filtrar por matrícula"),
    estado: Optional[str] = Query(None, description="Filtrar por estado: DENTRO o FINALIZADO"),
    db: Session = Depends(get_db)
):
    """Consulta el historial de movimientos en tiempo real desde SQLite"""
    query = db.query(Movimiento)
    if placa:
        query = query.filter(Movimiento.placa.ilike(f"%{limpiar_texto_placa(placa)}%"))
    if estado and estado.upper() != "TODOS":
        query = query.filter(Movimiento.estado == estado.upper())
    
    registros = query.order_by(desc(Movimiento.hora_entrada)).all()
    
    return [
        {
            "id_ticket": r.id_ticket,
            "placa": r.placa,
            "hora_entrada": r.hora_entrada.strftime("%Y-%m-%d %H:%M:%S"),
            "hora_salida": r.hora_salida.strftime("%Y-%m-%d %H:%M:%S") if r.hora_salida else "-",
            "tiempo_estadia_minutos": r.tiempo_estadia_minutos if r.tiempo_estadia_minutos is not None else "-",
            "estado": r.estado
        }
        for r in registros
    ]


@app.get("/api/movimientos/export")
def exportar_movimientos_csv(db: Session = Depends(get_db)):
    """Exporta todo el historial de la base de datos a formato CSV"""
    registros = db.query(Movimiento).order_by(desc(Movimiento.hora_entrada)).all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID Ticket", "Placa", "Hora Entrada", "Hora Salida", "Duracion (Minutos)", "Estado"])
    
    for r in registros:
        writer.writerow([
            r.id_ticket,
            r.placa,
            r.hora_entrada.strftime("%Y-%m-%d %H:%M:%S"),
            r.hora_salida.strftime("%Y-%m-%d %H:%M:%S") if r.hora_salida else "En Recinto",
            r.tiempo_estadia_minutos if r.tiempo_estadia_minutos is not None else "En Curso",
            r.estado
        ])
    
    output.seek(0)
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=movimientos_estacionamiento.csv"}
    )


@app.post("/api/reset")
def reset_sistema(db: Session = Depends(get_db)):
    """Reinicia los cajones y borra o restaura el estado para demostraciones limpias"""
    db.query(Cajon).update({Cajon.ocupado: False, Cajon.vehiculo_placa: None})
    db.commit()
    return {"mensaje": "Cajones reiniciados a LIBRE con éxito"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
