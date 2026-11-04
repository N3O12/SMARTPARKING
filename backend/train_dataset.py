"""
Script para entrenar YOLOv8 con el dataset de placas peruanas de Roboflow.
Genera automáticamente el archivo 'best.pt' que el backend de SGE Pro utiliza con máxima prioridad.
"""

import os
import sys
from ultralytics import YOLO

def entrenar_placas():
    print("=" * 60)
    print("SGE Pro - Entrenamiento YOLOv8 para Placas Peruanas")
    print("=" * 60)

    # 1. Verificar si existe data.yaml en la carpeta del dataset
    # Al descomprimir el ZIP de Roboflow, obtienes un archivo 'data.yaml'
    posibles_yaml = [
        "data.yaml",
        "dataset/data.yaml",
        "peru-license-plate/data.yaml",
        "../data.yaml"
    ]

    yaml_encontrado = None
    for p in posibles_yaml:
        if os.path.exists(p):
            yaml_encontrado = p
            break

    if not yaml_encontrado:
        print("\n[!] No se encontró el archivo 'data.yaml'.")
        print("Por favor descomprime tu dataset de Roboflow (el ZIP de ~40MB) dentro de:")
        print(f"   {os.path.abspath('.')}/dataset/")
        print("Asegúrate de que contenga el archivo 'data.yaml' y las carpetas train/ y valid/.\n")
        return

    print(f"\n[+] Dataset encontrado: {yaml_encontrado}")
    print("[+] Cargando modelo base ultraligero: yolov8n.pt...")
    model = YOLO("yolov8n.pt")

    print("\n[+] Iniciando entrenamiento por 25 épocas (optimizado para CPU y GPU)...")
    print("Al finalizar, los mejores pesos se guardarán automáticamente en 'best.pt'.\n")

    # Entrenar
    results = model.train(
        data=yaml_encontrado,
        epochs=25,
        imgsz=640,
        batch=8,
        name="peru_plates",
        verbose=True
    )

    # Copiar best.pt a la raíz de backend/ para que main.py lo tome de inmediato
    weights_path = "runs/detect/peru_plates/weights/best.pt"
    if os.path.exists(weights_path):
        import shutil
        shutil.copy(weights_path, "best.pt")
        print("\n" + "=" * 60)
        print("¡ENTRENAMIENTO COMPLETADO CON ÉXITO!")
        print(f"El archivo 'best.pt' fue creado en: {os.path.abspath('best.pt')}")
        print("El backend de FastAPI usará este modelo automáticamente.")
        print("=" * 60 + "\n")
    else:
        print(f"\n[!] Revisa los pesos en: {weights_path}")

if __name__ == "__main__":
    entrenar_placas()
