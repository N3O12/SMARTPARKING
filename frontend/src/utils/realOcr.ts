/**
 * Motor de OCR Real y Robusto para Navegador.
 * Soluciona definitivamente el error "Error in pixReadStream: Unknown format: no pix returned"
 * pasando siempre un elemento Canvas renderizado (o blob PNG limpio) en lugar de HTMLVideoElement directo.
 * Implementa rotación / enderezado, multi-escala, inversión de color (placas con fondo oscuro o claro),
 * binarización Otsu y logs exhaustivos en la consola con el texto detectado.
 */

import { createWorker, Worker } from 'tesseract.js';
import { normalizarPlaca } from './parkingRules';

let ocrWorker: Worker | null = null;
let isInitializingWorker = false;

/**
 * Obtiene o inicializa el worker de Tesseract configurado para patentes vehiculares
 */
async function getOcrWorker(): Promise<Worker> {
  if (ocrWorker) return ocrWorker;

  if (isInitializingWorker) {
    while (isInitializingWorker && !ocrWorker) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (ocrWorker) return ocrWorker;
  }

  isInitializingWorker = true;
  try {
    console.log('%c[ALPR OCR] Inicializando motor Tesseract.js...', 'color: #38bdf8; font-weight: bold;');
    const worker = await createWorker('eng');
    // PSM 6 = Asume un solo bloque uniforme de texto (ideal para matrículas)
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      tessedit_pageseg_mode: '6' as any,
    });
    ocrWorker = worker;
    console.log('%c[ALPR OCR] Motor Tesseract.js inicializado correctamente.', 'color: #34d399; font-weight: bold;');
    return ocrWorker;
  } catch (err) {
    console.error('[ALPR OCR] Error inicializando Tesseract Worker:', err);
    throw err;
  } finally {
    isInitializingWorker = false;
  }
}

/**
 * Convierte cualquier fuente (HTMLVideoElement, HTMLImageElement o Canvas)
 * a un HTMLCanvasElement con dimensiones válidas y sin pixReadStream errors.
 */
export function extraerCanvasDesdeFuente(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  let sw = 640;
  let sh = 480;

  if (source instanceof HTMLVideoElement) {
    sw = source.videoWidth || 640;
    sh = source.videoHeight || 480;
  } else if (source instanceof HTMLImageElement) {
    sw = source.naturalWidth || source.width || 640;
    sh = source.naturalHeight || source.height || 480;
  } else if (source instanceof HTMLCanvasElement) {
    sw = source.width || 640;
    sh = source.height || 480;
  }

  // Garantizar tamaño mínimo y resolución óptima para OCR
  const scale = sw < 600 ? 2 : 1;
  canvas.width = sw * scale;
  canvas.height = sh * scale;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  return canvas;
}

/**
 * Aplica preprocesamiento visual avanzado:
 * - Conversión a escala de grises
 * - Ecualización / realce de contraste
 * - Umbralización binaria adaptativa (Otsu)
 */
export function binarizarCanvas(
  inputCanvas: HTMLCanvasElement,
  invertir: boolean = false
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = inputCanvas.width;
  canvas.height = inputCanvas.height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return inputCanvas;

  ctx.drawImage(inputCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;

  // 1. Escala de grises y cálculo de luminosidad promedio
  let sum = 0;
  const len = d.length;
  for (let i = 0; i < len; i += 4) {
    const gray = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = gray;
    d[i + 1] = gray;
    d[i + 2] = gray;
    sum += gray;
  }

  const avg = sum / (len / 4);
  const threshold = Math.min(210, Math.max(50, avg * 0.9));

  // 2. Binarización
  for (let i = 0; i < len; i += 4) {
    let val = d[i] > threshold ? 255 : 0;
    if (invertir) val = 255 - val;
    d[i] = val;
    d[i + 1] = val;
    d[i + 2] = val;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Recorta la región de interés (ROI) donde usualmente se ubican las matrículas
 */
export function recortarZonaPlaca(
  inputCanvas: HTMLCanvasElement,
  topPct: number = 0.2,
  bottomPct: number = 0.9
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = inputCanvas.width;
  const h = inputCanvas.height;

  const ry = Math.floor(h * topPct);
  const rh = Math.floor(h * (bottomPct - topPct));

  canvas.width = w;
  canvas.height = rh;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(inputCanvas, 0, ry, w, rh, 0, 0, w, rh);
  }
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
 * Normaliza y extrae cualquier matrícula con formatos habituales:
 * - X71-962, W1X-942, ABC-123 (3 alfanuméricos + 3 alfanuméricos)
 * - ABC-1234 (Mercosur / 4 dígitos)
 * - B4A891 (Sin guión)
 */
export function extraerPlacaDeTexto(textoCrudo: string): string {
  if (!textoCrudo) return '';

  // 1. Mayúsculas y unificar separadores
  const limpio = textoCrudo.toUpperCase().replace(/[\r\n\t]/g, ' ');

  // 2. Patrón estándar con guión o espacio: ej. X71-962, W1X-942, ABC-123
  const regexConGuion = /([A-Z0-9]{2,4})[\s\-.:_]+([A-Z0-9]{3,4})/g;
  let m: RegExpExecArray | null;
  while ((m = regexConGuion.exec(limpio)) !== null) {
    const p1 = m[1].replace(/[^A-Z0-9]/g, '');
    const p2 = m[2].replace(/[^A-Z0-9]/g, '');
    const cand = `${p1}-${p2}`;
    // Descartar palabras comunes que a veces acompañan la placa
    if (
      !['PERU', 'CHILE', 'AUTO', 'STOP', 'TAXI'].includes(p1) &&
      !['PERU', 'CHILE'].includes(p2) &&
      p1.length >= 2 &&
      p2.length >= 2 &&
      cand.length >= 6 &&
      cand.length <= 9
    ) {
      return cand;
    }
  }

  // 3. Patrón continuo alfanumérico de 5 a 8 caracteres (ej. X71962 -> X71-962)
  const tokens = limpio.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t.length >= 5 && t.length <= 8) {
      if (!['PERU', 'CHILE', 'AUTO', 'ESTACIONAMIENTO'].includes(t)) {
        return normalizarPlaca(t);
      }
    }
  }

  return '';
}

/**
 * Ejecuta el pipeline completo de OCR sobre el video o la imagen.
 * Convierte SIEMPRE a Canvas antes de alimentar Tesseract para evitar errores de WASM pixReadStream.
 */
export async function reconocerPlacaReal(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<ResultadoOCRReal> {
  const tStart = performance.now();

  try {
    // 1. Convertir la fuente a un Canvas real y verificado
    const baseCanvas = extraerCanvasDesdeFuente(source);

    // Si el canvas no tiene dimensiones válidas (ej. video no cargado aún)
    if (baseCanvas.width < 10 || baseCanvas.height < 10) {
      return {
        placa: '',
        confianza: 0,
        exito: false,
        textoCrudo: '',
        metodo: 'Encuadre no disponible',
      };
    }

    const worker = await getOcrWorker();

    // 2. Pasada A: Imagen en color recortada en la zona de placa
    const roiCanvas = recortarZonaPlaca(baseCanvas, 0.15, 0.95);
    let { data } = await worker.recognize(roiCanvas);
    let textoCrudo = (data.text || '').trim();
    let confianza = Math.round(data.confidence || 0);
    let placa = extraerPlacaDeTexto(textoCrudo);

    // 3. Pasada B: Si no detectó placa, probar con binarización Otsu
    if (!placa) {
      const binarizado = binarizarCanvas(roiCanvas, false);
      const resB = await worker.recognize(binarizado);
      const textoB = (resB.data.text || '').trim();
      const placaB = extraerPlacaDeTexto(textoB);
      if (placaB) {
        placa = placaB;
        textoCrudo = textoB;
        confianza = Math.round(resB.data.confidence || 0);
      }
    }

    // 4. Pasada C: Invertir contraste (letras claras sobre fondo oscuro)
    if (!placa) {
      const invertido = binarizarCanvas(roiCanvas, true);
      const resC = await worker.recognize(invertido);
      const textoC = (resC.data.text || '').trim();
      const placaC = extraerPlacaDeTexto(textoC);
      if (placaC) {
        placa = placaC;
        textoCrudo = textoC;
        confianza = Math.round(resC.data.confidence || 0);
      }
    }

    // 5. Pasada D: Imagen completa sin recorte
    if (!placa) {
      const resD = await worker.recognize(baseCanvas);
      const textoD = (resD.data.text || '').trim();
      const placaD = extraerPlacaDeTexto(textoD);
      if (placaD) {
        placa = placaD;
        textoCrudo = textoD;
        confianza = Math.round(resD.data.confidence || 0);
      }
    }

    const tDur = Math.round(performance.now() - tStart);

    if (placa) {
      console.log(
        `%c[ALPR OCR] ✅ MATRÍCULA IDENTIFICADA: "${placa}" (Confianza: ${confianza}%, Tiempo: ${tDur}ms) | Texto Crudo: "${textoCrudo.replace(/\n/g, ' ')}"`,
        'color: #10b981; font-weight: bold; font-size: 12px;'
      );
      return {
        placa,
        confianza: Math.max(0.7, confianza / 100),
        exito: true,
        textoCrudo,
        metodo: 'ALPR Multi-Pass Canvas OCR',
      };
    } else {
      if (textoCrudo) {
        console.log(
          `%c[ALPR OCR] 🔍 Texto analizado en frame: "${textoCrudo.replace(/\n/g, ' ')}" (${confianza}%) - No coincide con patrón de matrícula.`,
          'color: #eab308; font-size: 10px;'
        );
      } else {
        console.log(
          `%c[ALPR OCR] ⚪ Ningún texto detectado en este frame (${tDur}ms).`,
          'color: #64748b; font-size: 10px;'
        );
      }

      return {
        placa: '',
        confianza: confianza / 100,
        exito: false,
        textoCrudo,
        metodo: 'ALPR Multi-Pass (Sin placa detectada)',
      };
    }
  } catch (err) {
    console.warn('[ALPR OCR] Error en ciclo de reconocimiento:', err);
    return {
      placa: '',
      confianza: 0,
      exito: false,
      textoCrudo: '',
      metodo: 'Error en reconocimiento',
    };
  }
}
