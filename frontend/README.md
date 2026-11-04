# Frontend - Sistema de Gestión de Estacionamiento Inteligente (SGE Pro)

Este proyecto frontend está desarrollado con **React (Vite + Tailwind CSS v4 + TypeScript + Lucide React)**.

## 🚀 Requisitos Previos
- **Node.js**: v18.0.0 o superior (recomendado v20+).
- **npm** o **pnpm** / **yarn**.

## 📦 Instalación y Ejecución en tu PC

Abre una terminal en tu computadora y ubícate dentro de la carpeta `frontend`:

```bash
# 1. Entrar a la carpeta frontend
cd frontend

# 2. Instalar todas las dependencias
npm install

# 3. Iniciar el servidor de desarrollo en el puerto 3000
npm run dev
```

La aplicación estará disponible inmediatamente en tu navegador:
👉 **http://localhost:3000**

---

## 🛠️ Scripts Disponibles en `frontend/package.json`

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia el servidor de desarrollo Vite en `http://localhost:3000` con recarga rápida. |
| `npm run build` | Compila la aplicación optimizada para producción en `dist/`. |
| `npm run preview` | Previsualiza el build de producción en un servidor local. |
| `npm run lint` | Ejecuta la verificación de tipos de TypeScript sin emitir archivos. |

---

## 🔌 Conexión con el Backend Python (FastAPI)
- Cuando el backend de Python esté ejecutándose en `http://localhost:8000`, el frontend se conectará automáticamente a él para consultar el aforo, registrar entradas/salidas en SQLite y procesar imágenes mediante YOLOv8 + EasyOCR.
- Si el backend aún no está iniciado, el frontend **conmuta automáticamente a un Motor Local Autónomo (In-Browser)** usando Tesseract.js para OCR real y persistencia en LocalStorage, permitiéndote probar la interfaz, el minimapa de 8 cajones, las cámaras y los tickets QR de inmediato.
