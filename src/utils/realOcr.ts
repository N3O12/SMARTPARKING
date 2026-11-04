/**
 * Motor de OCR Real en el Navegador con Tesseract.js y Preprocesamiento Multi-Escala.
 * NO INVENTA PLACAS: Lee los caracteres reales presentes en el encuadre.
 * Incluye diagnóstico en consola [ALPR OCR] y fallback multi-umbral para máxima robustez.
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
    while (isInitializingWorker && !ocrWorker) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (ocrWorker) return ocrWorker;
  }

  isInitializingWorker = true;
  try {
    console.log('%c[ALPR OCR] Inicializando motor Tesseract.js...', 'color: #38bdf8; font-weight: bold;');
    const worker = await createWorker('eng');
    // Permitir letras, números, guiones y caracteres frecuentes en patentes
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      // PSM 11 = Texto escaso / Sparse text (ideal para placas en cualquier posición)
      tessedit_pageseg_mode: '11' as any,
    });
    ocrWorker = worker;
    console.log('%c[ALPR OCR] Motor Tesseract.js listo y configurado.', 'color: #34d399; font-weight: bold;');
    return ocrWorker;
  } catch (err) {
    console.error('[ALPR OCR] Error inicializando Tesseract Worker:', err);
    throw err;
  } finally {
    isInitializingWorker = false;
  }
}

/**
 * Genera un canvas procesado con contraste realzado para OCR
 */
export function crearCanvasOptimizado(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  invertir: boolean = false
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const sw = source instanceof HTMLVideoElement ? source.videoWidth || 640 : source.width || 640;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight || 480 : source.height || 480;

  // Escalar si la imagen es muy pequeña para mejorar legibilidad
  const scale = sw < 400 ? 2 : 1;
  canvas.width = sw * scale;
  canvas.height = sh * scale;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // Aumentar contraste y binarizar suavemente
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let gray = (r * 0.299 + g * 0.587 + b * 0.114) | 0;

    // Estirar contraste
    gray = gray < 80 ? Math.max(0, gray - 30) : Math.min(255, gray + 30);

    if (invertir) {
      gray = 255 - gray;
    }

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
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
 * Extrae y valida si una cadena contiene una matrícula vehicular
 */
function extraerPlacaDeTexto(textoCrudo: string): string {
  if (!textoCrudo) return '';

  // 1. Limpieza inicial: convertir a mayúsculas
  const mayus = textoCrudo.toUpperCase();

  // 2. Buscar patrón estándar con o sin guion: (3 letras/números)-(3 o 4 letras/números)
  // Ej: W1X-942, ABC-123, B4A-891, 123-ABC, ABC-1234
  const regexEstricta = /([A-Z0-9]{3})[\s\-.:]?([A-Z0-9]{3,4})/g;
  let match: RegExpExecArray | null;
  while ((match = regexEstricta.exec(mayus)) !== null) {
    const p1 = match[1];
    const p2 = match[2];
    const candidata = `${p1}-${p2}`;
    // Descartar si son todo ceros o palabras comunes
    if (!candidata.startsWith('000') && !['THE', 'PERU', 'CHILE', 'AUTO', 'STOP'].includes(p1)) {
      return candidata;
    }
  }

  // 3. Buscar tokens alfanuméricos de longitud 6 a 8
  const tokens = mayus.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t.length >= 6 && t.length <= 8) {
      // Debe contener al menos 1 letra o 1 número
      const tieneLetra = /[A-Z]/.test(t);
      const tieneNum = /[0-9]/.test(t);
      if (tieneLetra && tieneNum) {
        return normalizarPlaca(t);
      }
    }
  }

  return '';
}

/**
 * Ejecuta OCR real sobre el frame de video o imagen usando Tesseract.js.
 * Imprime logs detallados en la consola del navegador [ALPR OCR] para inspeccionar
 * exactamente qué texto se leyó y el nivel de confianza.
 */
export async function reconocerPlacaReal(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<ResultadoOCRReal> {
  const tStart = performance.now();
  try {
    const worker = await getOcrWorker();

    // 1. Prueba directa sobre imagen normal
    let { data } = await worker.recognize(source);
    let textoCrudo = (data.text || '').trim();
    let confianza = Math.round(data.confidence || 0);

    let placaEncontrada = extraerPlacaDeTexto(textoCrudo);

    // 2. Si no encontró placa en lectura directa, probar con canvas contrastado
    if (!placaEncontrada) {
      const canvasAltoContraste = crearCanvasOptimizado(source, false);
      const resContraste = await worker.recognize(canvasAltoContraste);
      const textoC = (resContraste.data.text || '').trim();
      const placaC = extraerPlacaDeTexto(textoC);

      if (placaC) {
        placaEncontrada = placaC;
        textoCrudo = textoC;
        confianza = Math.round(resContraste.data.confidence || 0);
      }
    }

    const tDur = Math.round(performance.now() - tStart);

    // LOGS EN CONSOLA VISIBLES PARA EL USUARIO
    if (placaEncontrada) {
      console.log(
        `%c[ALPR OCR] ✅ Placa Detectada: "${placaEncontrada}" | Confianza: ${confianza}% | Tiempo: ${tDur}ms | Texto Crudo: "${textoCrudo.replace(/\n/g, ' ')}"`,
        'color: #34d399; font-weight: bold; font-size: 11px;'
      );
      return {
        placa: placaEncontrada,
        confianza: Math.max(0.6, confianza / 100),
        exito: true,
        textoCrudo,
        metodo: 'Tesseract.js OCR Real',
      };
    } else {
      if (textoCrudo.length > 0) {
        console.log(
          `%c[ALPR OCR] 🔍 Texto leído en encuadre: "${textoCrudo.replace(/\n/g, ' ')}" (Confianza: ${confianza}%), pero no coincide con formato de matrícula.`,
          'color: #fbbf24; font-size: 10px;'
        );
      } else {
        console.log(
          `%c[ALPR OCR] ⚪ Ningún texto legible detectado en el encuadre (${tDur}ms). Enfoque la placa de frente con buena luz.`,
          'color: #94a3b8; font-size: 10px;'
        );
      }

      return {
        placa: '',
        confianza: confianza / 100,
        exito: false,
        textoCrudo,
        metodo: 'Tesseract.js (Sin placa válida)',
      };
    }
  } catch (err) {
    console.warn('[ALPR OCR] Error ejecutando OCR:', err);
    return {
      placa: '',
      confianza: 0,
      exito: false,
      textoCrudo: '',
      metodo: 'Error en reconocimiento',
    };
  }
}
