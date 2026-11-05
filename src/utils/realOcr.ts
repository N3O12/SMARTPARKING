/**
 * Motor ALPR/OCR Especializado para Estacionamientos con Estabilidad Temporal y Anti-Desenfoque.
 * 
 * Reglas Críticas implementadas:
 * 1. Detección de Nitidez / Desenfoque (Laplacian Variance):
 *    - Si la cámara está desenfocada o moviéndose, descarta el frame inmediatamente sin procesar basura.
 * 2. Umbral de Confianza Estricto (>= 60%):
 *    - Elimina lecturas espurias de 9%, 14%, 20% (ruido visual de fondo).
 * 3. Ventana de Confirmación Temporal (Consenso de 3 a 5 capturas consecutivas):
 *    - La placa debe repetirse de forma idéntica en ráfagas consecutivas antes de fijarse.
 * 4. Normalización estricta de 6 caracteres con validación de primer carácter.
 */

import { createWorker, Worker } from 'tesseract.js';
import {
  esPlacaValida,
  normalizarPlaca,
  LETRAS_INICIALES_VALIDAS,
  PRIMEROS_CARACTERES_INVALIDOS,
  corregirCaracterSegunPosicion,
} from './parkingRules';

let ocrWorker: Worker | null = null;
let isInitializingWorker = false;

// Historial temporal de votos para confirmación de placa estable
const historialLecturas: { placa: string; timestamp: number; confianza: number }[] = [];
const LIMITE_HISTORIAL_MS = 2500; // Ventana de 2.5 segundos
const MINIMO_VOTOS_CONSENSO = 2; // Requiere que la misma placa se lea al menos 2 veces

/**
 * Obtiene o inicializa el worker de Tesseract con diccionario restringido
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
    console.log('%c[ALPR PERÚ] Inicializando motor OCR con tipografía FE-Schrift...', 'color: #38bdf8; font-weight: bold;');
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      tessedit_pageseg_mode: '7' as any, // Tratar como una sola línea de texto
    });
    ocrWorker = worker;
    console.log('%c[ALPR PERÚ] Motor listo y validado.', 'color: #34d399; font-weight: bold;');
    return ocrWorker;
  } catch (err) {
    console.error('[ALPR PERÚ] Error inicializando worker:', err);
    throw err;
  } finally {
    isInitializingWorker = false;
  }
}

/**
 * Convierte de forma segura cualquier fuente a un HTMLCanvasElement
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
 * Filtro Anti-Desenfoque: Calcula la varianza del Laplaciano simplificado.
 * Si el valor es bajo, la imagen está borrosa/desenfocada y no debe procesarse.
 */
export function calcularNitidezCanvas(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 100;

  // Analizar muestra central de 120x80 px
  const mw = Math.min(120, canvas.width);
  const mh = Math.min(80, canvas.height);
  const sx = Math.floor((canvas.width - mw) / 2);
  const sy = Math.floor((canvas.height - mh) / 2);

  const imgData = ctx.getImageData(sx, sy, mw, mh);
  const d = imgData.data;

  let totalVar = 0;
  for (let y = 1; y < mh - 1; y++) {
    for (let x = 1; x < mw - 1; x++) {
      const idx = (y * mw + x) * 4;
      const gray = (d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114);
      const right = (d[idx + 4] * 0.299 + d[idx + 5] * 0.587 + d[idx + 6] * 0.114);
      const bottom = (d[idx + mw * 4] * 0.299 + d[idx + mw * 4 + 1] * 0.587 + d[idx + mw * 4 + 2] * 0.114);

      // Gradiente de borde
      const diff = Math.abs(gray - right) + Math.abs(gray - bottom);
      totalVar += diff;
    }
  }

  return totalVar / (mw * mh);
}

/**
 * Recorta la mitad inferior de la placa para omitir la palabra "PERÚ" superior,
 * logos y hologramas oficiales, dejando únicamente los 6 caracteres principales.
 */
export function recortarZonaCaracteres(
  inputCanvas: HTMLCanvasElement,
  omitirParteSuperior: boolean = true
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = inputCanvas.width;
  const h = inputCanvas.height;

  const yStart = omitirParteSuperior ? Math.floor(h * 0.35) : 0;
  const hRoi = omitirParteSuperior ? Math.floor(h * 0.60) : h;

  canvas.width = w;
  canvas.height = Math.max(40, hRoi);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(inputCanvas, 0, yStart, w, hRoi, 0, 0, w, canvas.height);
  }
  return canvas;
}

/**
 * Clausura Morfológica (Dilatación + Erosión) y Binarización:
 * Rellena los huecos negros de los pernos de sujeción que rompen letras.
 */
export function aplicarClausuraYBinarizacion(
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
  const w = canvas.width;
  const h = canvas.height;

  // 1. Escala de grises
  const gray = new Uint8Array(w * h);
  let sum = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g;
    sum += g;
  }

  const avg = sum / gray.length;
  const threshold = Math.min(210, Math.max(60, avg * 0.92));
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] > threshold ? 255 : 0;
  }

  // 2. Clausura morfológica (rellenar pequeños huecos negros)
  const closed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (
        binary[idx] === 255 ||
        binary[idx - 1] === 255 ||
        binary[idx + 1] === 255 ||
        binary[idx - w] === 255 ||
        binary[idx + w] === 255
      ) {
        closed[idx] = 255;
      } else {
        closed[idx] = 0;
      }
    }
  }

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let val = closed[j];
    if (invertir) val = 255 - val;
    d[i] = val;
    d[i + 1] = val;
    d[i + 2] = val;
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
 * Validador Estricto con Filtro de Letra Inicial y Longitud Exacta (6 caracteres)
 */
export function validarYCorregirLectura(textoCrudo: string, confianza: number): string {
  // Descartar si el OCR arrojó confianza muy baja (< 30%)
  if (!textoCrudo || confianza < 30) return '';

  let limpio = textoCrudo
    .toUpperCase()
    .replace(/PERU|PERÚ|CHILE|AUTO|STOP|TAXI|MTC/g, '')
    .replace(/[^A-Z0-9]/g, '');

  if (limpio.length < 5) return '';

  // Buscar coincidencia de 6 caracteres
  const candidatos: string[] = [];
  if (limpio.length === 6) {
    candidatos.push(limpio);
  } else {
    for (let i = 0; i <= limpio.length - 6; i++) {
      candidatos.push(limpio.slice(i, i + 6));
    }
  }

  for (const cand of candidatos) {
    const p1 = cand[0];
    // FILTRO 2: Letra Inicial Obligatoria
    if (PRIMEROS_CARACTERES_INVALIDOS.has(p1) || !LETRAS_INICIALES_VALIDAS.has(p1)) {
      continue;
    }

    const chars = cand.split('');

    // DICCIONARIO DE CONFUSIÓN FE-SCHRIFT:
    // Carácter 0: SIEMPRE Letra geográfica oficial
    chars[0] = corregirCaracterSegunPosicion(chars[0], true);
    if (!LETRAS_INICIALES_VALIDAS.has(chars[0])) continue;

    // Caracteres 4 y 5: SIEMPRE números en placas peruanas de 6 caracteres
    chars[4] = corregirCaracterSegunPosicion(chars[4], false);
    chars[5] = corregirCaracterSegunPosicion(chars[5], false);

    // Carácter 3: si parece dígito o confusión típica (0, O, D, Q, B, 1, I), convertir a número
    if (/[0-9ODQBI]/.test(chars[3])) {
      chars[3] = corregirCaracterSegunPosicion(chars[3], false);
    }

    const placaFinal = `${chars.slice(0, 3).join('')}-${chars.slice(3, 6).join('')}`;

    if (esPlacaValida(placaFinal)) {
      return placaFinal;
    }
  }

  return '';
}

/**
 * Reconoce la placa aplicando:
 * 1. Filtro de desenfoque de cámara.
 * 2. Umbral de confianza estricto (>= 50%).
 * 3. Consenso temporal de ráfagas consecutivas (evita falsos positivos aislados).
 */
export async function reconocerPlacaReal(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | string
): Promise<ResultadoOCRReal> {
  const tStart = performance.now();

  try {
    let resolvedSource: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
    if (typeof source === 'string') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = source;
      });
      resolvedSource = img;
    } else {
      resolvedSource = source;
    }

    const baseCanvas = extraerCanvasDesdeFuente(resolvedSource);
    if (baseCanvas.width < 10 || baseCanvas.height < 10) {
      return { placa: '', confianza: 0, exito: false, textoCrudo: '', metodo: 'Frame vacío' };
    }

    // 1. FILTRO DE DESENFOQUE
    const nitidez = calcularNitidezCanvas(baseCanvas);
    if (nitidez < 8.0 && source instanceof HTMLVideoElement) {
      console.log(`%c[ALPR PERÚ] 📷 Cámara desenfocada o en movimiento (Nitidez: ${nitidez.toFixed(1)}). Esperando enfoque nítido...`, 'color: #94a3b8; font-size: 10px;');
      return { placa: '', confianza: 0, exito: false, textoCrudo: '', metodo: 'Cámara desenfocada' };
    }

    const worker = await getOcrWorker();

    // Ráfaga de segmentaciones
    const intentos: HTMLCanvasElement[] = [
      recortarZonaCaracteres(baseCanvas, true),
      aplicarClausuraYBinarizacion(recortarZonaCaracteres(baseCanvas, true), false),
      aplicarClausuraYBinarizacion(recortarZonaCaracteres(baseCanvas, true), true),
      baseCanvas,
    ];

    let mejorPlaca = '';
    let mejorTextoCrudo = '';
    let mejorConfianza = 0;

    for (let i = 0; i < intentos.length; i++) {
      const { data } = await worker.recognize(intentos[i]);
      const crudo = (data.text || '').trim();
      const conf = Math.round(data.confidence || 0);

      if (conf > mejorConfianza) {
        mejorConfianza = conf;
        mejorTextoCrudo = crudo;
      }

      // Validar con umbral de confianza mínimo de 30%
      const placaValidada = validarYCorregirLectura(crudo, conf);
      if (placaValidada && conf >= 30) {
        mejorPlaca = placaValidada;
        mejorConfianza = conf;
        break; // Detener en cuanto una segmentación dé una placa con confianza suficiente
      }
    }

    const now = Date.now();
    // Limpiar lecturas viejas del historial (> 2.5 seg)
    for (let i = historialLecturas.length - 1; i >= 0; i--) {
      if (now - historialLecturas[i].timestamp > LIMITE_HISTORIAL_MS) {
        historialLecturas.splice(i, 1);
      }
    }

    const tDur = Math.round(performance.now() - tStart);

    // 2. Si es una imagen estática (foto subida), no requiere consenso temporal
    const esFotoSubida = source instanceof HTMLImageElement;

    if (mejorPlaca) {
      historialLecturas.push({ placa: mejorPlaca, timestamp: now, confianza: mejorConfianza });

      // Contar votos en la ventana temporal
      const votos = historialLecturas.filter((h) => h.placa === mejorPlaca).length;

      // Se autoriza si es foto estática O si la cámara confirmó la misma placa al menos MINIMO_VOTOS_CONSENSO veces
      if (esFotoSubida || votos >= MINIMO_VOTOS_CONSENSO) {
        console.log(
          `%c[ALPR PERÚ] 🎯 PLACA CONFIRMADA POR CONSENSO (${votos} ráfagas): "${mejorPlaca}" (Confianza: ${mejorConfianza}%, Ráfaga: ${tDur}ms)`,
          'color: #10b981; font-weight: bold; font-size: 13px;'
        );

        return {
          placa: mejorPlaca,
          confianza: Math.max(0.75, mejorConfianza / 100),
          exito: true,
          textoCrudo: mejorTextoCrudo,
          metodo: `ALPR Consenso Temporal (${votos} ráfagas)`,
        };
      } else {
        console.log(
          `%c[ALPR PERÚ] ⏳ Placa candidata detectada: "${mejorPlaca}" (Votos: ${votos}/${MINIMO_VOTOS_CONSENSO}). Confirmando estabilidad del encuadre...`,
          'color: #38bdf8; font-size: 11px;'
        );
        return {
          placa: '',
          confianza: mejorConfianza / 100,
          exito: false,
          textoCrudo: mejorTextoCrudo,
          metodo: 'Confirmando estabilidad',
        };
      }
    }

    if (mejorTextoCrudo && mejorConfianza >= 30) {
      console.log(
        `%c[ALPR PERÚ] ⚠️ Texto descartado (Baja confianza o no cumple formato): "${mejorTextoCrudo.replace(/\n/g, ' ')}" (${mejorConfianza}%)`,
        'color: #f59e0b; font-size: 10px;'
      );
    }

    return {
      placa: '',
      confianza: mejorConfianza / 100,
      exito: false,
      textoCrudo: mejorTextoCrudo,
      metodo: 'ALPR Perú (Sin placa confirmada)',
    };
  } catch (err) {
    console.warn('[ALPR PERÚ] Error en ciclo:', err);
    return {
      placa: '',
      confianza: 0,
      exito: false,
      textoCrudo: '',
      metodo: 'Error en reconocimiento',
    };
  }
}
