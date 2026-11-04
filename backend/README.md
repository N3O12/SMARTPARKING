# SGE Pro - Backend FastAPI & ALPR / OCR (YOLOv8 + OpenCV + EasyOCR)

Este es el backend completo en Python del **Sistema de Gestión de Estacionamiento Inteligente (SGE Pro)**. Implementa persistencia en SQLite (`estacionamiento.db`), localización precisa de vehículos y placas con **YOLOv8** (`ultralytics`), preprocesamiento de imagen con OpenCV y extracción de texto con EasyOCR, generación de tickets QR reales y validación cruzada antirrobo.

---

## 🚀 Requisitos Previos

- **Python 3.10 o superior** instalado en tu sistema.
- Acceso a terminal (PowerShell, CMD, Bash o Zsh).

---

## 🛠️ Instrucciones de Instalación y Ejecución en PC

### 1. Ubicarse en la carpeta del backend
```bash
cd backend
```

### 2. Crear y activar el entorno virtual

**En Windows (PowerShell / CMD):**
```bash
python -m venv venv
# En PowerShell:
.\venv\Scripts\Activate.ps1
# O en CMD:
.\venv\Scripts\activate.bat
```

**En Linux / macOS:**
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Instalar dependencias requeridas (incluye Ultralytics YOLOv8 y PyTorch)
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

> **Nota sobre YOLOv8 y EasyOCR:** En el primer arranque, Ultralytics descargará automáticamente el modelo compacto `yolov8n.pt` (~6MB) y EasyOCR descargará el modelo de caracteres. Si tu PC cuenta con GPU NVIDIA, puedes instalar PyTorch con CUDA para inferencia a 60+ FPS; de lo contrario funcionará con total fluidez en CPU.

### 4. Iniciar el servidor FastAPI
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

El servidor quedará disponible en:
- **API Base:** `http://localhost:8000`
- **Documentación Interactiva Swagger:** `http://localhost:8000/docs`
- **Documentación ReDoc:** `http://localhost:8000/redoc`

---

## 📡 Endpoints Implementados

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/estado` | Retorna contadores (`en_recinto`, `ocupados`, `libres`, `en_transito`, `total_historico`) y estado de los 8 cajones. |
| `POST` | `/api/cajones/{id}/toggle` | Alterna el estado del sensor ultrasónico de un cajón (`LIBRE` ↔ `OCUPADO`). |
| `POST` | `/api/ocr` | Procesa frame Base64 con OpenCV + EasyOCR para extraer matrícula limpia (ej. `W1X-942`). |
| `POST` | `/api/entrada` | Valida aforo (< 8) y placa repetida, genera ticket con QR real y abre barrera. |
| `POST` | `/api/salida` | **Validación Cruzada Antirrobo:** Compara `placa_qr` vs `placa_camara`. Si no coinciden, dispara alerta de fraude y bloquea barrera. |
| `GET` | `/api/movimientos` | Consulta historial con filtros opcionales (`?placa=...&estado=...`). |
| `GET` | `/api/movimientos/export` | Descarga el historial en formato CSV compatible con Excel. |
| `POST` | `/api/reset` | Reinicia cajones a estado libre. |
