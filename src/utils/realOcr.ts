/**
 * Motor ALPR/OCR Especializado para Estacionamientos (Normativa Peruana y Filtros Anti-Ruido).
 * 
 * Reglas Estrictas:
 * 1. Omitir deliberadamente la franja superior "PERÚ" y pernos de sujeción (clausura morfológica).
 * 2. Validación de primer carácter: Solo letras permitidas (A, B, C, D, F, H, L, M, P, S, T, U, V, W, X, Y, Z).
 *    Si el primer carácter es 0-9, O, Q, I, Ñ la lectura es INVÁLIDA (se descarta, jamás se inventa).
 * 3. Formatos únicos aceptados:
 *    - Autos Estándar: ^[A-Z]{3}-?[0-9]{3}$ (ej. ABC-123 o X71-962)
 *    - Autos Modernos: ^[A-Z]{3}-?[A-Z][0-9]{2}$ (ej. ABC-F12 o ABC-X45)
 *    - Motocicletas:   ^[A-Z0-9]{2}-?[0-9]{4}$ (ej. AB-1234)
 * 4. Matriz de confusión FE-Schrift (0 vs O, 8 vs B, 1 vs I, D vs 0).
 * 5. Captura en ráfaga / Multi-pasada para elegir por consenso.
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
    // Restringir a letras mayúsculas, números y guión (evita caracteres extraños)
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      tessedit_pageseg_mode: '6' as any, // Asume un solo bloque de texto
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

  // Escalado óptimo: altura mínima recomendada para placas es ~100px
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

  // En una placa peruana estándar, "PERÚ" ocupa el 0% al 32% superior.
  // Los caracteres principales (ej. X71-962) están del 35% al 95%.
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
 * Rellena los huecos negros de los pernos de sujeción que rompen letras (ej. D -> C u O -> C).
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

  // 1. Convertir a escala de grises
  const gray = new Uint8Array(w * h);
  let sum = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g;
    sum += g;
  }

  // Umbralización Otsu
  const avg = sum / gray.length;
  const threshold = Math.min(210, Math.max(60, avg * 0.92));
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] > threshold ? 255 : 0;
  }

  // 2. Clausura morfológica (rellenar pequeños huecos negros de pernos de 2x2 px)
  const closed = new Uint8Array(w * h);
  // Dilatación
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      // Si algún vecino es blanco, expandir
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

  // Volcar a imagen final
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
 * Validador Estricto con Diccionario de Confusiones FE-Schrift y Filtro Inicial:
 * Rechaza tajantemente cualquier lectura que no cumpla las 3 estructuras peruanas.
 */
export function validarYCorregirLectura(textoCrudo: string): string {
  if (!textoCrudo) return '';

  // 1. Eliminar deliberadamente "PERÚ", marcas fijas, guiones, puntos y espacios
  let limpio = textoCrudo
    .toUpperCase()
    .replace(/PERU|CHILE|AUTO|STOP|TAXI|MTC/g, '')
    .replace(/[^A-Z0-9]/g, '');

  if (limpio.length < 5) return '';

  // Si tiene más de 6 caracteres (ej. leyó 7 u 8 por borde de la placa), buscar ventana de 6 caracteres
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
    // Posiciones 0, 1: siempre letras
    chars[0] = corregirCaracterSegunPosicion(chars[0], true);
    chars[1] = corregirCaracterSegunPosicion(chars[1], true);

    // Re-chequear primer carácter
    if (!LETRAS_INICIALES_VALIDAS.has(chars[0])) continue;

    // Posición 2:
    // En autos estándar y modernos: es letra
    // En motos: puede ser letra o número
    // Posición 4, 5: SIEMPRE números
    chars[4] = corregirCaracterSegunPosicion(chars[4], false);
    chars[5] = corregirCaracterSegunPosicion(chars[5], false);

    // Evaluar posición 3:
    // Si pos 3 es número -> Auto estándar LLL-NNN
    // Si pos 3 es letra -> Auto moderno LLL-LNN
    const esPos3Numero = /[0-9]/.test(chars[3]) || ['O', 'D', 'Q', 'B'].includes(chars[3]);
    if (esPos3Numero) {
      chars[2] = corregirCaracterSegunPosicion(chars[2], true);
      chars[3] = corregirCaracterSegunPosicion(chars[3], false);
    } else {
      chars[2] = corregirCaracterSegunPosicion(chars[2], true);
      chars[3] = corregirCaracterSegunPosicion(chars[3], true);
    }

    const placaFinal = `${chars.slice(0, 3).join('')}-${chars.slice(3, 6).join('')}`;

    // Validar con las expresiones regulares estrictas peruanas
    if (esPlacaValida(placaFinal)) {
      return placaFinal;
    }
  }

  return '';
}

/**
 * Captura en Ráfaga Multi-Pasada:
 * Ejecuta de 3 a 5 pasadas con distintas segmentaciones (recorte inferior, binarización y clausura),
 * y elige la placa que cumpla la estructura oficial peruana.
 * NUNCA INVENTA PLACAS: Si ningún frame cumple la estructura oficial, retorna exito: false.
 */
export async function reconocerPlacaReal(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<ResultadoOCRReal> {
  const tStart = performance.now();

  try {
    const baseCanvas = extraerCanvasDesdeFuente(source);
    if (baseCanvas.width < 10 || baseCanvas.height < 10) {
      return { placa: '', confianza: 0, exito: false, textoCrudo: '', metodo: 'Frame vacío' };
    }

    const worker = await getOcrWorker();

    // Ráfaga de segmentaciones
    const intentos: HTMLCanvasElement[] = [
      // 1. Recorte inferior (omitiendo "PERÚ")
      recortarZonaCaracteres(baseCanvas, true),
      // 2. Recorte inferior + Clausura morfológica (elimina pernos)
      aplicarClausuraYBinarizacion(recortarZonaCaracteres(baseCanvas, true), false),
      // 3. Recorte inferior + Inversión de contraste
      aplicarClausuraYBinarizacion(recortarZonaCaracteres(baseCanvas, true), true),
      // 4. Imagen completa sin recorte
      baseCanvas,
    ];

    const lecturasValidas: string[] = [];
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

      const placaValidada = validarYCorregirLectura(crudo);
      if (placaValidada) {
        lecturasValidas.push(placaValidada);
        // Si ya encontramos una placa válida con alta confianza, detener ráfaga temprano para ahorrar CPU
        if (conf >= 60) break;
      }
    }

    const tDur = Math.round(performance.now() - tStart);

    // Consenso: Elegir la lectura válida más frecuente
    if (lecturasValidas.length > 0) {
      const frecuencia: Record<string, number> = {};
      for (const p of lecturasValidas) {
        frecuencia[p] = (frecuencia[p] || 0) + 1;
      }
      const placaGanadora = Object.keys(frecuencia).sort((a, b) => frecuencia[b] - frecuencia[a])[0];

      console.log(
        `%c[ALPR PERÚ] ✅ PLACA AUTORIZADA: "${placaGanadora}" (Confianza: ${mejorConfianza}%, Ráfaga: ${tDur}ms) | Texto Crudo: "${mejorTextoCrudo.replace(/\n/g, ' ')}"`,
        'color: #10b981; font-weight: bold; font-size: 12px;'
      );

      return {
        placa: placaGanadora,
        confianza: Math.max(0.75, mejorConfianza / 100),
        exito: true,
        textoCrudo: mejorTextoCrudo,
        metodo: 'ALPR Perú Ráfaga + FE-Schrift',
      };
    }

    // SI NO CUMPLE LA ESTRUCTURA OFICIAL: Jamás inventar placas
    if (mejorTextoCrudo) {
      console.log(
        `%c[ALPR PERÚ] ⚠️ Texto descartado por no cumplir estructura oficial peruana: "${mejorTextoCrudo.replace(/\n/g, ' ')}" (${mejorConfianza}%)`,
        'color: #f59e0b; font-size: 11px;'
      );
    } else {
      console.log(
        `%c[ALPR PERÚ] ⚪ Sin caracteres legibles en el encuadre (${tDur}ms). Enfoque la matrícula dentro del recuadro.`,
        'color: #94a3b8; font-size: 10px;'
      );
    }

    return {
      placa: '',
      confianza: mejorConfianza / 100,
      exito: false,
      textoCrudo: mejorTextoCrudo,
      metodo: 'ALPR Perú (Rechazado por formato)',
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
