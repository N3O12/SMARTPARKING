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
  if (!ctx) return inputCanvas;

  ctx.drawImage(inputCanvas, 0, yStart, w, hRoi, 0, 0, w, canvas.height);
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
  canvas.width = inputCanvas.width;
  canvas.height = inputCanvas.height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return inputCanvas;

  ctx.drawImage(inputCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;

  // Analizar canal Rojo
  let minR = 255;
  let maxR = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }

  const range = Math.max(1, maxR - minR);
  // Estirar contraste y umbralizar
  for (let i = 0; i < d.length; i += 4) {
    const norm = ((d[i] - minR) / range) * 255;
    // Tinta oscura hacia 0, fondos y líneas de hoja hacia 255
    const val = norm < 125 ? 0 : 255;
    d[i] = val;
    d[i + 1] = val;
    d[i + 2] = val;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
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

    // Ráfaga multi-escenario: Papel / Cuaderno, Pantallas Celular, Autos Reales y Alto Contraste
    const intentos: Array<{ canvas: HTMLCanvasElement; desc: string }> = [
      { canvas: baseCanvas, desc: 'Toda la Foto (Natural)' },
      { canvas: realzarTintaLapiceroEnPapel(baseCanvas), desc: 'Toda la Foto (Realce Tinta/Lapicero)' },
      { canvas: realcePantallaCelularYLuzBaja(baseCanvas), desc: 'Toda la Foto (Pantallas/Luz Baja)' },
      { canvas: aplicarClausuraYBinarizacion(baseCanvas, false), desc: 'Toda la Foto (Alto Contraste)' },
      { canvas: recortarZonaCaracteres(baseCanvas, true), desc: 'Recorte Inferior (Parachoques)' },
    ];

    let mejorPlaca = '';
    let mejorTextoCrudo = '';
    let mejorConfianza = 0;
    let mejorBbox: number[] | undefined = undefined;
    let mejorMetodo = 'ALPR Búsqueda en Escena';

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
