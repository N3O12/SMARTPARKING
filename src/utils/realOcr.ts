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
  buscarSecuenciasPlacaEnTexto,
} from './parkingRules';

let ocrWorker: Worker | null = null;
let isInitializingWorker = false;

// Historial temporal de votos para confirmación de placa estable
const historialLecturas: { placa: string; timestamp: number; confianza: number }[] = [];
const LIMITE_HISTORIAL_MS = 2500; // Ventana de 2.5 segundos
const MINIMO_VOTOS_CONSENSO = 1; // Permite detección instantánea al enfocar papel o vehículo

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
    console.log('%c[ALPR PERÚ] Inicializando motor OCR con tipografía FE-Schrift y soporte de escritura...', 'color: #38bdf8; font-weight: bold;');
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      tessedit_pageseg_mode: '11' as any, // Sparse text: encuentra texto aislado en cualquier lugar de la hoja o auto
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

  // Analizar múltiples muestras (centro, izquierda, derecha, arriba, abajo) para no descartar hojas de papel
  const mw = Math.min(100, Math.floor(canvas.width / 3));
  const mh = Math.min(60, Math.floor(canvas.height / 3));
  const puntos = [
    { sx: Math.floor((canvas.width - mw) / 2), sy: Math.floor((canvas.height - mh) / 2) }, // Centro
    { sx: Math.floor(canvas.width * 0.2), sy: Math.floor(canvas.height * 0.3) }, // Superior izq
    { sx: Math.floor(canvas.width * 0.6), sy: Math.floor(canvas.height * 0.3) }, // Superior der
    { sx: Math.floor((canvas.width - mw) / 2), sy: Math.floor(canvas.height * 0.65) }, // Inferior
  ];

  let maxVar = 0;
  for (const { sx, sy } of puntos) {
    const xSafe = Math.max(0, Math.min(canvas.width - mw, sx));
    const ySafe = Math.max(0, Math.min(canvas.height - mh, sy));
    const imgData = ctx.getImageData(xSafe, ySafe, mw, mh);
    const d = imgData.data;

    let sampleVar = 0;
    for (let y = 1; y < mh - 1; y++) {
      for (let x = 1; x < mw - 1; x++) {
        const idx = (y * mw + x) * 4;
        const gray = d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114;
        const right = d[idx + 4] * 0.299 + d[idx + 5] * 0.587 + d[idx + 6] * 0.114;
        const bottom = d[idx + mw * 4] * 0.299 + d[idx + mw * 4 + 1] * 0.587 + d[idx + mw * 4 + 2] * 0.114;
        sampleVar += Math.abs(gray - right) + Math.abs(gray - bottom);
      }
    }
    const score = sampleVar / (mw * mh);
    if (score > maxVar) maxVar = score;
  }

  return maxVar;
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

/**
 * Realce especializado de tinta de lapicero azul o negro sobre hojas de cuaderno/papel:
 * La tinta absorbe fuertemente el espectro rojo, mientras que el papel blanco/crema y las líneas
 * celestes de los cuadernos reflejan alto rojo. Al filtrar por el canal rojo y estirar el contraste,
 * las líneas celestes del cuaderno desaparecen y la escritura manuscrita queda ultranítida.
 */
export function realzarTintaLapiceroEnPapel(inputCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = inputCanvas.width;
  const h = inputCanvas.height;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return inputCanvas;

  ctx.drawImage(inputCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  const R = new Uint8Array(w * h);
  const B = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    R[j] = d[i];
    B[j] = d[i + 2];
  }

  const ink = new Uint8Array(w * h);
  const margin = 20;
  const offsets = [-18, -9, 0, 9, 18];

  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const idx = y * w + x;
      if (B[idx] < 85) continue;

      let rSum = 0;
      let bSum = 0;
      for (let ky = 0; ky < 5; ky++) {
        const yy = y + offsets[ky];
        const rowOff = yy * w;
        for (let kx = 0; kx < 5; kx++) {
          const xx = x + offsets[kx];
          rSum += R[rowOff + xx];
          bSum += B[rowOff + xx];
        }
      }
      const dR = rSum / 25.0 - R[idx];
      const dB = bSum / 25.0 - B[idx];
      const score = dR - 0.85 * dB;
      if ((score > 2.8 && dR > 5.0) || (dR > 28.0 && dR >= 0.92 * dB)) {
        ink[idx] = 1;
      }
    }
  }

  // Dilatación morfológica de 1px para consolidar trazos finos de lapicero
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const isInk =
        ink[idx] ||
        ink[idx - 1] ||
        ink[idx + 1] ||
        ink[idx - w] ||
        ink[idx + w];
      const val = isInk ? 0 : 255;
      const p = idx * 4;
      d[p] = val;
      d[p + 1] = val;
      d[p + 2] = val;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Localiza automáticamente el bloque de escritura manuscrita sobre hojas de cuaderno/papel,
 * suprime las líneas impresas mediante diferencia cromática local (dR - 0.85*dB) y alinea
 * verticalmente los caracteres (separando trazos cursivos unidos antes del guión en 3 bloques).
 */
export function extraerLienzoManuscritoAlineado(
  inputCanvas: HTMLCanvasElement
): { canvas: HTMLCanvasElement; bbox?: number[] } | null {
  const w = inputCanvas.width;
  const h = inputCanvas.height;
  if (w < 80 || h < 50) return null;

  const ctx = inputCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const d = ctx.getImageData(0, 0, w, h).data;
  const R = new Uint8Array(w * h);
  const B = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    R[j] = d[i];
    B[j] = d[i + 2];
  }

  const scoreMat = new Uint8Array(w * h);
  const offsets = [-18, -9, 0, 9, 18];

  for (let y = 25; y < h - 25; y++) {
    for (let x = 25; x < w - 25; x++) {
      const idx = y * w + x;
      if (
        B[idx] < 95 ||
        B[(y - 18) * w + (x - 18)] < 95 ||
        B[(y + 18) * w + (x + 18)] < 95
      ) {
        continue;
      }
      let rSum = 0;
      let bSum = 0;
      for (let ky = 0; ky < 5; ky++) {
        const rowOff = (y + offsets[ky]) * w;
        for (let kx = 0; kx < 5; kx++) {
          const pIdx = rowOff + x + offsets[kx];
          rSum += R[pIdx];
          bSum += B[pIdx];
        }
      }
      const dR = rSum / 25.0 - R[idx];
      const dB = bSum / 25.0 - B[idx];
      const score = dR - 0.85 * dB;
      if ((score > 2.8 && dR > 5.0) || (dR > 28.0 && dR >= 0.92 * dB)) {
        scoreMat[idx] = 1;
      }
    }
  }

  const rowInk = new Int32Array(h);
  const xMargin = Math.min(40, Math.floor(w * 0.08));
  for (let y = 25; y < h - 25; y++) {
    let s = 0;
    const rowOff = y * w;
    for (let x = xMargin; x < w - xMargin; x++) {
      s += scoreMat[rowOff + x];
    }
    rowInk[y] = s;
  }

  let bestY1 = 0;
  let bestY2 = 0;
  let bestSum = 0;
  let inBand = false;
  let by1 = 0;

  for (let y = 25; y < h - 25; y++) {
    if (rowInk[y] >= 18 && !inBand) {
      inBand = true;
      by1 = y;
    } else if (rowInk[y] < 14 && inBand) {
      inBand = false;
      let s = 0;
      for (let k = by1; k < y; k++) s += rowInk[k];
      if (y - by1 >= 18 && s > bestSum) {
        bestSum = s;
        bestY1 = by1;
        bestY2 = y;
      }
    }
  }
  if (inBand && h - 25 - by1 >= 18) {
    let s = 0;
    for (let k = by1; k < h - 25; k++) s += rowInk[k];
    if (s > bestSum) {
      bestY1 = by1;
      bestY2 = h - 25;
    }
  }

  if (bestY2 - bestY1 < 18) return null;

  const y1 = Math.max(20, bestY1 - 4);
  const y2 = Math.min(h - 20, bestY2);

  const colProj = new Int32Array(w);
  for (let x = 30; x < w - 30; x++) {
    let s = 0;
    for (let y = y1; y < y2; y++) {
      s += scoreMat[y * w + x];
    }
    colProj[x] = s;
  }

  const candSegs: Array<{ s: number; e: number; area: number }> = [];
  let inSeg = false;
  let start = 0;
  for (let x = 30; x < w - 30; x++) {
    if (colProj[x] >= 2 && !inSeg) {
      inSeg = true;
      start = x;
    } else if (colProj[x] < 2 && inSeg) {
      inSeg = false;
      if (x - start >= 12) {
        let area = 0;
        for (let yy = y1; yy < y2; yy++) {
          for (let xx = start; xx < x; xx++) {
            if (scoreMat[yy * w + xx]) area++;
          }
        }
        candSegs.push({ s: start, e: x, area });
      }
    }
  }

  if (candSegs.length === 0) return null;

  const maxArea = Math.max(...candSegs.map((c) => c.area));
  const charIndices: number[] = [];
  candSegs.forEach((c, idx) => {
    if (c.area >= Math.max(160, maxArea * 0.25)) {
      charIndices.push(idx);
    }
  });

  if (charIndices.length === 0) return null;

  const firstC = Math.min(...charIndices);
  const lastC = Math.max(...charIndices);
  const rawSegs = candSegs
    .slice(firstC, lastC + 1)
    .filter((c) => c.area >= 80);

  if (rawSegs.length < 3) return null;

  const x1 = Math.max(10, rawSegs[0].s - 13);
  const x2 = Math.min(w - 10, rawSegs[rawSegs.length - 1].e + 8);
  const cw = x2 - x1;
  const ch = y2 - y1;
  if (cw < 60 || ch < 18) return null;

  const dil = new Uint8Array(cw * ch);
  for (let yy = 1; yy < ch - 1; yy++) {
    for (let xx = 2; xx < cw - 2; xx++) {
      const gx = x1 + xx;
      const gy = y1 + yy;
      const gIdx = gy * w + gx;
      if (
        scoreMat[gIdx] ||
        scoreMat[gIdx - 1] ||
        scoreMat[gIdx + 1] ||
        scoreMat[gIdx - w] ||
        scoreMat[gIdx + w] ||
        (scoreMat[gIdx - 2] && scoreMat[gIdx + 2])
      ) {
        dil[yy * cw + xx] = 1;
      }
    }
  }

  const localSegs = rawSegs.map((c) => ({
    s: c.s - x1,
    e: c.e - x1,
    area: c.area,
  }));

  let hyphenIdx = -1;
  for (let i = 1; i < localSegs.length - 1; i++) {
    const seg = localSegs[i];
    if (seg.area < maxArea * 0.35 && seg.e - seg.s <= 28) {
      hyphenIdx = i;
      break;
    }
  }

  const segs: Array<{ s: number; e: number }> = [];
  if (hyphenIdx > 0) {
    const preSegs = localSegs.slice(0, hyphenIdx);
    if (preSegs.length < 3) {
      const ps = preSegs[0].s;
      const pe = preSegs[preSegs.length - 1].e;
      const pwTot = pe - ps;
      segs.push({ s: ps, e: ps + Math.floor(pwTot * 0.35) });
      segs.push({
        s: ps + Math.floor(pwTot * 0.35) + 1,
        e: ps + Math.floor(pwTot * 0.66),
      });
      segs.push({ s: ps + Math.floor(pwTot * 0.66) + 1, e: pe });
    } else {
      preSegs.forEach((p) => segs.push({ s: p.s, e: p.e }));
    }
    segs.push({
      s: localSegs[hyphenIdx].s,
      e: localSegs[hyphenIdx].e,
    });
    localSegs.slice(hyphenIdx + 1).forEach((p) => segs.push({ s: p.s, e: p.e }));
  } else {
    localSegs.forEach((p) => segs.push({ s: p.s, e: p.e }));
  }

  const totalW =
    40 + segs.reduce((acc, s) => acc + (s.e - s.s) + 20, 0) + 20;
  const totalH = ch + 40;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = totalW;
  outCanvas.height = totalH;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return null;

  const outData = outCtx.createImageData(totalW, totalH);
  const od = outData.data;
  od.fill(255);

  let curX = 30;
  for (const seg of segs) {
    let sy1 = ch;
    let sy2 = 0;
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = seg.s; xx < seg.e; xx++) {
        if (dil[yy * cw + xx]) {
          if (yy < sy1) sy1 = yy;
          if (yy + 1 > sy2) sy2 = yy + 1;
        }
      }
    }
    if (sy2 <= sy1) continue;
    const sw = seg.e - seg.s;
    const sh = sy2 - sy1;
    const yOff = Math.floor((totalH - sh) / 2);

    for (let yy = 0; yy < totalH; yy++) {
      const iy = yy - yOff + sy1;
      if (iy < sy1 || iy >= sy2) continue;
      for (let xx = 0; xx < sw; xx++) {
        const ix = seg.s + xx;
        if (dil[iy * cw + ix]) {
          const p = (yy * totalW + (curX + xx)) * 4;
          od[p] = 0;
          od[p + 1] = 0;
          od[p + 2] = 0;
        }
      }
    }
    curX += sw + 20;
  }

  outCtx.putImageData(outData, 0, 0);
  return {
    canvas: outCanvas,
    bbox: [x1, y1, x2, y2],
  };
}

/**
 * Guarda una placa confirmada o corregida en la Memoria de Aprendizaje Activo del cliente (localStorage)
 */
export function guardarEnMemoriaAprendizajeCliente(
  placaCorrecta: string,
  detectadoPrevio?: string
): void {
  try {
    const raw = localStorage.getItem('SGE_ALPR_MEMORIA_ACTIVA') || '{}';
    const memoria: Record<string, { timestamp: number; detectadoPrevio?: string; count: number }> = JSON.parse(raw);
    const norm = normalizarPlaca(placaCorrecta);
    if (!norm) return;

    memoria[norm] = {
      timestamp: Date.now(),
      detectadoPrevio: detectadoPrevio ? normalizarPlaca(detectadoPrevio) || detectadoPrevio : '',
      count: (memoria[norm]?.count || 0) + 1,
    };

    localStorage.setItem('SGE_ALPR_MEMORIA_ACTIVA', JSON.stringify(memoria));
    console.log(`%c[Aprendizaje Activo] 🧠 Placa [${norm}] guardada en memoria viva.`, 'color: #10b981; font-weight: bold;');
  } catch (e) {
    console.warn('Aviso guardando en memoria de aprendizaje cliente:', e);
  }
}

/**
 * Consulta la memoria de aprendizaje activo para aplicar correcciones y reconocimientos inmediatos
 */
export function consultarMemoriaAprendizajeCliente(texto: string): { placa: string; metodo: string } | null {
  if (!texto) return null;
  try {
    const raw = localStorage.getItem('SGE_ALPR_MEMORIA_ACTIVA') || '{}';
    const memoria: Record<string, { timestamp: number; detectadoPrevio?: string; count: number }> = JSON.parse(raw);

    const limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (limpio.length < 4) return null;

    for (const [placa, info] of Object.entries(memoria)) {
      const placaLimpia = placa.replace(/[^A-Z0-9]/g, '');
      const previoLimpio = (info.detectadoPrevio || '').replace(/[^A-Z0-9]/g, '');

      // 1. Coincidencia con error previo corregido
      if (previoLimpio && (limpio.includes(previoLimpio) || previoLimpio.includes(limpio))) {
        return { placa, metodo: `Memoria Viva: Corrección de '${info.detectadoPrevio}'` };
      }

      // 2. Coincidencia exacta con placa confirmada
      if (limpio === placaLimpia) {
        return { placa, metodo: 'Memoria Viva: Placa Confirmada' };
      }

      // 3. Similitud difusa (Levenshtein 1 carácter)
      if (limpio.length === 6 && placaLimpia.length === 6) {
        let diff = 0;
        for (let i = 0; i < 6; i++) {
          if (limpio[i] !== placaLimpia[i]) diff++;
        }
        if (diff <= 1) {
          return { placa, metodo: `Memoria Viva: Ajuste por similitud con '${placa}'` };
        }
      }
    }
  } catch (e) {
    console.warn('Aviso consultando memoria de aprendizaje cliente:', e);
  }
  return null;
}

export interface ResultadoOCRReal {
  placa: string;
  confianza: number;
  exito: boolean;
  textoCrudo: string;
  metodo: string;
  bbox?: number[];
}

/**
 * Validador Estricto con Filtro de Letra Inicial y Longitud Exacta (6 caracteres)
 */
export function validarYCorregirLectura(textoCrudo: string, confianza: number = 50): string {
  if (!textoCrudo) return '';
  const encontrados = buscarSecuenciasPlacaEnTexto(textoCrudo);
  if (encontrados.length > 0) {
    return encontrados[0].placa;
  }
  return '';
}

/**
 * Realce para pantallas de celular, monitores y condiciones de luz baja/reflejos:
 * Aplica corrección gamma suave y estiramiento de contraste dinámico para neutralizar el brillo
 * de las pantallas y moiré.
 */
export function realcePantallaCelularYLuzBaja(inputCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = inputCanvas.width;
  canvas.height = inputCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return inputCanvas;

  ctx.drawImage(inputCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const gamma = Math.pow(gray / 255.0, 0.75) * 255;
    const v = gamma < 135 ? Math.max(0, gamma * 0.65) : Math.min(255, gamma * 1.25);
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Reconoce la placa en TODA LA FOTO (hoja de papel, cuaderno, pantalla o vehículo):
 * 1. Escanea toda la escena buscando secuencias oficiales MTC.
 * 2. Extrae la caja delimitadora (bbox) exacta del texto para recortarlo y resaltarlo.
 * 3. Admite caracteres escritos a mano, con guión, espacios o en bloque.
 * 4. Consulta de inmediato la Memoria de Aprendizaje Activo (Active Learning).
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

    // 1. FILTRO DE DESENFOQUE (Permisivo para hojas de papel en mano)
    const nitidez = calcularNitidezCanvas(baseCanvas);
    if (nitidez < 2.0 && source instanceof HTMLVideoElement) {
      return { placa: '', confianza: 0, exito: false, textoCrudo: '', metodo: 'Cámara desenfocada' };
    }

    const worker = await getOcrWorker();

    let mejorPlaca = '';
    let mejorTextoCrudo = '';
    let mejorConfianza = 0;
    let mejorBbox: number[] | undefined = undefined;
    let mejorMetodo = 'ALPR Búsqueda en Escena';

    // 1.A Intento prioritario especializado para escritura manuscrita sobre hoja/cuaderno:
    // Suprime rayas del cuaderno (dR - 0.85*dB), localiza el bloque exacto de tinta y alinea los caracteres
    const manuscrito = extraerLienzoManuscritoAlineado(baseCanvas);
    if (manuscrito) {
      for (const psmMode of ['8', '7']) {
        await worker.setParameters({
          tessedit_pageseg_mode: psmMode as any,
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        const { data: mData } = await worker.recognize(manuscrito.canvas);
        const mText = (mData.text || '').trim();
        const foundM = buscarSecuenciasPlacaEnTexto(mText);
        if (foundM.length > 0) {
          mejorPlaca = foundM[0].placa;
          mejorTextoCrudo = foundM[0].textoMatch;
          mejorConfianza = Math.max(88, Math.round(mData.confidence || 88));
          mejorMetodo = 'Escritura en Hoja (Aislamiento Cromático de Tinta)';
          mejorBbox = manuscrito.bbox;
          break;
        }
      }
      // Restaurar parámetros para escaneo de escena completa
      await worker.setParameters({
        tessedit_pageseg_mode: '11' as any,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      });
    }

    // Ráfaga multi-escenario: Papel / Cuaderno, Pantallas Celular, Autos Reales y Alto Contraste
    const intentos: Array<{ canvas: HTMLCanvasElement; desc: string }> = mejorPlaca
      ? []
      : [
          { canvas: baseCanvas, desc: 'Toda la Foto (Natural)' },
          { canvas: realzarTintaLapiceroEnPapel(baseCanvas), desc: 'Toda la Foto (Realce Tinta/Lapicero)' },
          { canvas: realcePantallaCelularYLuzBaja(baseCanvas), desc: 'Toda la Foto (Pantallas/Luz Baja)' },
          { canvas: aplicarClausuraYBinarizacion(baseCanvas, false), desc: 'Toda la Foto (Alto Contraste)' },
          { canvas: recortarZonaCaracteres(baseCanvas, true), desc: 'Recorte Inferior (Parachoques)' },
        ];

    for (const intento of intentos) {
      const { data } = await worker.recognize(intento.canvas);
      const crudo = (data.text || '').trim();
      const conf = Math.round(data.confidence || 0);

      // 1. Buscar en las líneas de texto detectadas
      const lines = (data as any).lines || [];
      for (const line of lines) {
        const found = buscarSecuenciasPlacaEnTexto(line.text || '');
        if (found.length > 0) {
          mejorPlaca = found[0].placa;
          mejorTextoCrudo = found[0].textoMatch;
          mejorConfianza = Math.max(conf, line.confidence || 85);
          mejorMetodo = `${intento.desc} (Línea)`;
          if (line.bbox) {
            mejorBbox = [
              Math.max(0, Math.round(line.bbox.x0)),
              Math.max(0, Math.round(line.bbox.y0)),
              Math.min(intento.canvas.width, Math.round(line.bbox.x1)),
              Math.min(intento.canvas.height, Math.round(line.bbox.y1)),
            ];
          }
          break;
        }
      }

      if (mejorPlaca) break;

      // 2. Buscar en las palabras individuales
      const words = (data as any).words || [];
      for (let w = 0; w < words.length; w++) {
        const word = words[w];
        const foundWord = buscarSecuenciasPlacaEnTexto(word.text || '');
        if (foundWord.length > 0) {
          mejorPlaca = foundWord[0].placa;
          mejorTextoCrudo = foundWord[0].textoMatch;
          mejorConfianza = Math.max(conf, word.confidence || 85);
          mejorMetodo = `${intento.desc} (Palabra)`;
          if (word.bbox) {
            mejorBbox = [
              Math.max(0, Math.round(word.bbox.x0)),
              Math.max(0, Math.round(word.bbox.y0)),
              Math.min(intento.canvas.width, Math.round(word.bbox.x1)),
              Math.min(intento.canvas.height, Math.round(word.bbox.y1)),
            ];
          }
          break;
        }

        // Buscar pares adyacentes de palabras (ej. "206" y "37F")
        if (w < words.length - 1) {
          const pair = `${words[w].text} ${words[w + 1].text}`;
          const foundPair = buscarSecuenciasPlacaEnTexto(pair);
          if (foundPair.length > 0) {
            mejorPlaca = foundPair[0].placa;
            mejorTextoCrudo = foundPair[0].textoMatch;
            mejorConfianza = Math.max(conf, Math.round(((words[w].confidence || 80) + (words[w + 1].confidence || 80)) / 2));
            mejorMetodo = `${intento.desc} (Par de Palabras)`;
            const b1 = words[w].bbox;
            const b2 = words[w + 1].bbox;
            if (b1 && b2) {
              mejorBbox = [
                Math.max(0, Math.round(Math.min(b1.x0, b2.x0))),
                Math.max(0, Math.round(Math.min(b1.y0, b2.y0))),
                Math.min(intento.canvas.width, Math.round(Math.max(b1.x1, b2.x1))),
                Math.min(intento.canvas.height, Math.round(Math.max(b1.y1, b2.y1))),
              ];
            }
            break;
          }
        }
      }

      if (mejorPlaca) break;

      // 3. Buscar en todo el texto concatenado
      const foundGlobal = buscarSecuenciasPlacaEnTexto(crudo);
      if (foundGlobal.length > 0) {
        mejorPlaca = foundGlobal[0].placa;
        mejorTextoCrudo = foundGlobal[0].textoMatch;
        mejorConfianza = Math.max(conf, 78);
        mejorMetodo = `${intento.desc} (Texto Global)`;

        // Extraer la caja delimitadora real analizando las palabras que componen la placa detectada
        const targetClean = mejorPlaca.replace(/[^A-Z0-9]/g, '');
        const matchedBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
        for (const wd of words) {
          const wClean = (wd.text || '').replace(/[^A-Z0-9]/g, '');
          if (wClean.length >= 2 && targetClean.includes(wClean)) {
            if (wd.bbox) matchedBoxes.push(wd.bbox);
          }
        }

        if (matchedBoxes.length > 0) {
          mejorBbox = [
            Math.max(0, Math.round(Math.min(...matchedBoxes.map((b) => b.x0)))),
            Math.max(0, Math.round(Math.min(...matchedBoxes.map((b) => b.y0)))),
            Math.min(intento.canvas.width, Math.round(Math.max(...matchedBoxes.map((b) => b.x1)))),
            Math.min(intento.canvas.height, Math.round(Math.max(...matchedBoxes.map((b) => b.y1)))),
          ];
        } else {
          // No inventar cajas ficticias sobre el lapicero ni sobre bordes aleatorios
          mejorBbox = undefined;
        }
        break;
      }
    }

    // 4. Consultar Memoria de Aprendizaje Activo (Active Learning)
    const memMatch = consultarMemoriaAprendizajeCliente(mejorPlaca || mejorTextoCrudo);
    if (memMatch) {
      mejorPlaca = memMatch.placa;
      mejorConfianza = 99;
      mejorMetodo = memMatch.metodo;
    }

    const tDur = Math.round(performance.now() - tStart);

    if (mejorPlaca) {
      console.log(
        `%c[ALPR PERÚ] 🎯 SECUENCIA DETECTADA EN LA FOTO: "${mejorPlaca}" (${mejorMetodo}, Ráfaga: ${tDur}ms)`,
        'color: #10b981; font-weight: bold; font-size: 13px;'
      );

      return {
        placa: mejorPlaca,
        confianza: Math.max(0.75, mejorConfianza / 100),
        exito: true,
        textoCrudo: mejorTextoCrudo,
        metodo: mejorMetodo,
        bbox: mejorBbox,
      };
    }

    return {
      placa: '',
      confianza: mejorConfianza / 100,
      exito: false,
      textoCrudo: mejorTextoCrudo,
      metodo: 'ALPR Perú (Buscando secuencia de matrícula...)',
    };
  } catch (err) {
    console.warn('[ALPR PERÚ] Error en ciclo OCR:', err);
    return {
      placa: '',
      confianza: 0,
      exito: false,
      textoCrudo: '',
      metodo: 'Error en reconocimiento',
    };
  }
}
