/**
 * Motor de OCR Real en el Navegador con Tesseract.js y Preprocesamiento de Imagen en Canvas.
 * NO INVENTA PLACAS: Lee exclusivamente los caracteres reales presentes en el encuadre.
 */

import { createWorker, Worker } from 'tesseract.js';
import { normalizarPlaca } from './parkingRules';

let ocrWorker: Worker | null = null;
let isInitializingWorker = false;

/**
 * Obtiene o inicializa el worker de Tesseract para reconocimiento rápido
 */
async function getOcrWorker(): Promise<Worker> {
  if (ocrWorker) return ocrWorker;

  if (isInitializingWorker) {
    // Esperar a que el worker actual termine de inicializar
    while (isInitializingWorker && !ocrWorker) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ocrWorker) return ocrWorker;
  }

  isInitializingWorker = true;
  try {
    const worker = await createWorker('eng');
    // Configurar para reconocimiento de caracteres de matrículas vehiculares
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
      tessedit_pageseg_mode: '7' as any, // Tratar la imagen como una sola línea de texto
    });
    ocrWorker = worker;
    return ocrWorker;
  } catch (err) {
    console.error('Error inicializando Tesseract Worker:', err);
    throw err;
  } finally {
    isInitializingWorker = false;
  }
}

/**
 * Preprocesa una imagen (base64 o canvas/video) con OpenCV/Canvas para maximizar contraste
 * y aislar los caracteres de la matrícula:
 * 1. Conversión a escala de grises.
 * 2. Realce de contraste y binarización adaptativa (letras oscuras sobre fondo claro o viceversa).
 */
export function preprocesarCanvasParaOCR(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  roi?: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const sw = source instanceof HTMLVideoElement ? source.videoWidth || 640 : source.width || 640;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight || 480 : source.height || 480;

  // Zona de interés (ROI)
  const rx = roi ? Math.max(0, roi.x) : Math.floor(sw * 0.15);
  const ry = roi ? Math.max(0, roi.y) : Math.floor(sh * 0.25);
  const rw = roi ? Math.min(sw - rx, roi.width) : Math.floor(sw * 0.7);
  const rh = roi ? Math.min(sh - ry, roi.height) : Math.floor(sh * 0.5);

  canvas.width = Math.max(200, rw);
  canvas.height = Math.max(80, rh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) return canvas;

  // Dibujar el recorte en el canvas
  ctx.drawImage(source, rx, ry, rw, rh, 0, 0, canvas.width, canvas.height);

  // Obtener pixeles para binarización
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // 1. Escala de grises con pesos luminosos
  let sumLuminance = 0;
  const grayValues = new Uint8Array(data.length / 4);

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
    grayValues[j] = gray;
    sumLuminance += gray;
  }

  // Umbral promedio
  const avgLuminance = sumLuminance / grayValues.length;
  // Umbral de Otsu simplificado para contraste extremo
  const threshold = Math.min(200, Math.max(60, avgLuminance * 0.95));

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const val = grayValues[j] > threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export interface ResultadoOCRReal {
  placa: string;
  confianza: number;
  exito: boolean;
  textoCrudo: string;
  metodo: string;
}

/**
 * Ejecuta OCR real sobre el frame de video o imagen usando Tesseract.js.
 * NO INVENTA PLACAS: Si no hay texto que coincida con una matrícula, retorna exito: false y placa: ""
 */
export async function reconocerPlacaReal(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  roi?: { x: number; y: number; width: number; height: number }
): Promise<ResultadoOCRReal> {
  try {
    const worker = await getOcrWorker();
    const processedCanvas = preprocesarCanvasParaOCR(source, roi);

    const { data } = await worker.recognize(processedCanvas);
    const textoCrudo = (data.text || '').trim();
    const confianza = Math.round(data.confidence || 0);

    // Limpiar y buscar patrones de placa (ej. ABC-123, W1X-942, ABC1234, etc.)
    const soloAlfanumerico = textoCrudo.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Buscar coincidencia de 6 o 7 caracteres alfanuméricos
    let placaEncontrada = '';

    // Patrón 1: 3 letras/números seguidos de 3 o 4 letras/números
    const matchPlaca = soloAlfanumerico.match(/([A-Z0-9]{3})([A-Z0-9]{3,4})/);
    if (matchPlaca) {
      placaEncontrada = `${matchPlaca[1]}-${matchPlaca[2]}`;
    } else if (soloAlfanumerico.length >= 5 && soloAlfanumerico.length <= 8) {
      placaEncontrada = normalizarPlaca(soloAlfanumerico);
    }

    if (placaEncontrada && confianza >= 40) {
      return {
        placa: placaEncontrada,
        confianza: confianza / 100,
        exito: true,
        textoCrudo,
        metodo: 'Tesseract.js OCR Real',
      };
    }

    // Si encontró texto pero no tiene formato de placa o la confianza es baja
    return {
      placa: '',
      confianza: confianza / 100,
      exito: false,
      textoCrudo,
      metodo: 'Tesseract.js (Sin placa válida)',
    };
  } catch (err) {
    console.warn('Reconocimiento OCR falló o fue cancelado:', err);
    return {
      placa: '',
      confianza: 0,
      exito: false,
      textoCrudo: '',
      metodo: 'Error en reconocimiento',
    };
  }
}
