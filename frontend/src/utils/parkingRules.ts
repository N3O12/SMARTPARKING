/**
 * Reglas de negocio y especificación oficial de matrículas para SGE Pro (Normativa Peruana y ALPR).
 * 
 * 1. Formatos Únicos Permitidos:
 *    - Autos / Camionetas Estándar: 3 letras + 3 números (ej. ABC-123 o ABC123). Regex: ^[A-Z]{3}-?[0-9]{3}$
 *    - Autos Modernos Combinados: 3 letras + 1 letra + 2 números (ej. ABC-F12 o ABC-X45). Regex: ^[A-Z]{3}-?[A-Z][0-9]{2}$
 *    - Motocicletas: 2 caracteres alfanuméricos + 4 números (ej. AB-1234 o 12-AB34). Regex: ^[A-Z0-9]{2}-?[0-9]{4}$
 * 
 * 2. Filtro de Letra Inicial (Validación del Lector):
 *    - Primer carácter OBLIGATORIO: A, B, C, D, F, H, L, M, P, S, T, U, V, W, X, Y, Z.
 *    - Letras PROHIBIDAS en posición 1: O, Q, I, Ñ o cualquier número (0-9).
 * 
 * 3. Diccionario de Confusiones FE-Schrift (Posición 4, 5, 6):
 *    - '0' (Cero) vs 'O' (Letra): en pos 4, 5 o 6 en placas estándar siempre es NÚMERO (0).
 *    - '8' vs 'B': en posiciones numéricas se convierte B -> 8; en posiciones alfabéticas 8 -> B.
 *    - '1' vs 'I': en posiciones numéricas se convierte I -> 1; en posiciones alfabéticas 1 -> I.
 *    - 'D' vs '0': corrección según posición.
 */

export interface CajonEstado {
  id: string; // 'A1' - 'A4', 'B1' - 'B4'
  ocupado: boolean;
  vehiculo_placa?: string | null;
}

export interface MovimientoRegistro {
  id_ticket: string;
  placa: string;
  hora_entrada: string;
  hora_salida: string | null;
  tiempo_estadia_minutos: number | null;
  estado: 'DENTRO' | 'FINALIZADO';
}

export const CAPACIDAD_MAXIMA = 8;

export const CAJONES_INICIALES: CajonEstado[] = [
  { id: 'A1', ocupado: false },
  { id: 'A2', ocupado: false },
  { id: 'A3', ocupado: false },
  { id: 'A4', ocupado: false },
  { id: 'B1', ocupado: false },
  { id: 'B2', ocupado: false },
  { id: 'B3', ocupado: false },
  { id: 'B4', ocupado: false },
];

/** Letras iniciales oficiales permitidas para la zona geográfica y serie */
/** Letras y caracteres iniciales oficiales permitidos (Zona geográfica o series de motos MTC) */
export const LETRAS_INICIALES_VALIDAS = new Set([
  'A', 'B', 'C', 'D', 'E', 'F', 'H', 'L', 'M', 'P', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '1', '2', '3', '4', '5', '6', '7', '8', '9'
]);

export const CARACTERES_INICIALES_VALIDOS = LETRAS_INICIALES_VALIDAS;

/** Letras y caracteres estrictamente prohibidos en primera posición según MTC */
export const PRIMEROS_CARACTERES_INVALIDOS = new Set([
  '0', 'O', 'Q', 'I', 'Ñ'
]);

/**
 * Aplica corrección de confusiones comunes según la posición (FE-Schrift):
 * - Posiciones 0, 1, 2 (Letras en autos estándar y modernos):
 *     0 -> O (o D), 1 -> I, 8 -> B, 5 -> S, 2 -> Z
 * - Posiciones 3, 4, 5 (Números en autos estándar):
 *     O -> 0, Q -> 0, D -> 0, I -> 1, L -> 1, B -> 8, S -> 5, Z -> 2
 */
export function corregirCaracterSegunPosicion(
  char: string,
  debeSerLetra: boolean
): string {
  const c = char.toUpperCase();
  if (debeSerLetra) {
    if (c === '0') return 'O';
    if (c === '1') return 'I';
    if (c === '8') return 'B';
    if (c === '5') return 'S';
    if (c === '2') return 'Z';
    return c;
  } else {
    // Debe ser número
    if (c === 'O' || c === 'Q' || c === 'D') return '0';
    if (c === 'I' || c === 'L' || c === 'T') return '1';
    if (c === 'B') return '8';
    if (c === 'S') return '5';
    if (c === 'Z') return '2';
    if (c === 'G') return '6';
    return c;
  }
}

/**
 * Valida si una placa cumple estrictamente con cualquiera de las estructuras legales peruanas (MTC):
 * 1. Autos y camionetas estándar: 3 alfanuméricos + 3 dígitos (ej. ABC-123, W2U-792, A1A-123, X71-962, AEF-710, 206-371)
 * 2. Motos y trimóviles (L1-L5 MTC): 3 alfanuméricos + 2 dígitos + 1 letra (ej. 206-37F, 123-45M, 456-78A)
 * 3. Autos modernos combinados: 3 alfanuméricos + 1 letra + 2 dígitos (ej. ABC-X45, ABC-F12)
 * 4. Motocicletas serie 2+4: 2 alfanuméricos + 4 dígitos (ej. 20-6371, AB-1234, 12-3456)
 *
 * NOTA CRÍTICA ANTI-ALUCINACIÓN:
 * Se rechazan categóricamente sufijos espurios de ruido OCR como "J8E" (letra-número-letra),
 * "WCM" (3 letras), o cualquier cadena sin la combinación numérica oficial.
 */
export function esPlacaValida(placa: string): boolean {
  if (!placa) return false;
  const sinGuion = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sinGuion.length !== 6) return false;

  const primerChar = sinGuion[0];
  if (PRIMEROS_CARACTERES_INVALIDOS.has(primerChar) || !CARACTERES_INICIALES_VALIDOS.has(primerChar)) {
    return false;
  }

  // 1. Descartar cadenas sin al menos 2 dígitos reales (evita palabras como COO-WCM o títulos web)
  const numDigitos = (sinGuion.match(/[0-9]/g) || []).length;
  if (numDigitos < 2) return false;

  // Formato 1: Autos estándar, camionetas y comerciales (3 alfanuméricos + 3 dígitos)
  // Ejemplos: W2U-792, ABC-123, X71-962, AEF-710, A1B-234, 206-371
  const regexAutoEstandar = /^[A-Z0-9]{3}-?[0-9]{3}$/;

  // Formato 2: Motocicletas y trimóviles MTC (3 alfanuméricos + 2 dígitos + 1 letra)
  // Ejemplos: 206-37F, 123-45M, 456-78A, A12-34B
  const regexMotoMTC = /^[A-Z0-9]{3}-?[0-9]{2}[A-Z]$/;

  // Formato 3: Autos modernos combinados (3 alfanuméricos + 1 letra + 2 dígitos)
  // Ejemplos: ABC-X45, F5U-B12
  const regexAutoModerno = /^[A-Z0-9]{3}-?[A-Z][0-9]{2}$/;

  // Formato 4: Motocicletas serie 2+4 (2 alfanuméricos + 4 dígitos)
  // Ejemplos: 20-6371, AB-1234, 12-3456
  const regexMoto2Plus4 = /^[A-Z0-9]{2}-?[0-9]{4}$/;

  return (
    regexAutoEstandar.test(placa) ||
    regexAutoEstandar.test(sinGuion) ||
    regexMotoMTC.test(placa) ||
    regexMotoMTC.test(sinGuion) ||
    regexAutoModerno.test(placa) ||
    regexAutoModerno.test(sinGuion) ||
    regexMoto2Plus4.test(placa) ||
    regexMoto2Plus4.test(sinGuion)
  );
}

/**
 * Limpia y normaliza una matrícula aplicando los formatos peruanos autorizados (MTC):
 * 1. Autos Estándar / Comerciales: LLL-NNN o LNL-NNN (ej. X71-962, W2U-792, ABC-123)
 * 2. Motos / Trimóviles MTC: NNN-NNL (ej. 206-37F, 123-45M)
 * 3. Autos Modernos: LLL-LNN (ej. ABC-X45)
 * 4. Motos clásicas: LL-NNNN o NN-NNNN (ej. 20-6371, AB-1234)
 */
export function normalizarPlaca(texto: string): string {
  if (!texto) return '';

  // 1. Omitir palabras fijas de cabeceras oficiales y ruidos comunes
  let limpio = texto
    .toUpperCase()
    .replace(/PERU|PERÚ|CHILE|AUTO|STOP|TAXI|MTC/g, '')
    .replace(/[^A-Z0-9]/g, '');

  if (limpio.length < 5) return '';

  // 2. Si tiene exactamente 6 caracteres
  if (limpio.length === 6) {
    const c0 = limpio[0];
    if (PRIMEROS_CARACTERES_INVALIDOS.has(c0) || !CARACTERES_INICIALES_VALIDOS.has(c0)) {
      return '';
    }

    // Formato 3+3 (Autos, camionetas o motos 3+3 ej. 206-37F, W2U-792)
    const p1 = limpio.slice(0, 3);
    const p2 = limpio.slice(3, 6);
    const conGuion = `${p1}-${p2}`;

    if (esPlacaValida(conGuion)) {
      return conGuion;
    }

    // Formato 2+4 (Motos ej. 20-6371)
    const conGuionMoto = `${limpio.slice(0, 2)}-${limpio.slice(2, 6)}`;
    if (esPlacaValida(conGuionMoto)) {
      return conGuionMoto;
    }

    // Corrección adaptativa de confusiones OCR frecuentes (O->0, I->1, B->8 en zonas numéricas)
    // Intento A: Sufijo numérico (ej. W2U-792 o 206-371)
    const p2Num = p2
      .replace(/[OQD]/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/B/g, '8')
      .replace(/S/g, '5')
      .replace(/Z/g, '2')
      .replace(/G/g, '6');
    const candA = `${p1}-${p2Num}`;
    if (esPlacaValida(candA)) {
      return candA;
    }

    // Intento B: Sufijo de moto con letra final (ej. 206-37F)
    const p2Moto =
      p2.slice(0, 2)
        .replace(/[OQD]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/B/g, '8')
        .replace(/S/g, '5')
        .replace(/Z/g, '2') + p2.slice(2);
    const candB = `${p1}-${p2Moto}`;
    if (esPlacaValida(candB)) {
      return candB;
    }

    return '';
  }

  // 3. Si tiene más de 6 caracteres (ej. "PERUW2U792" o ruidos pegados), buscar subsecuencia válida
  if (limpio.length > 6) {
    for (let i = 0; i <= limpio.length - 6; i++) {
      const sub = limpio.slice(i, i + 6);
      const res = normalizarPlaca(sub);
      if (res && esPlacaValida(res)) {
        return res;
      }
    }
  }

  return '';
}

/**
 * Escanea cualquier texto libre (como el leído en una hoja de papel, cuaderno, pantalla o escena completa)
 * buscando secuencias que cumplan con la estructura de matrícula vehicular peruana oficial MTC.
 */
export function buscarSecuenciasPlacaEnTexto(texto: string): Array<{ placa: string; textoMatch: string }> {
  if (!texto) return [];
  const candidatos: Array<{ placa: string; textoMatch: string }> = [];
  const encontradas = new Set<string>();

  // Normalizar acentos y pasar a mayúsculas
  const t = texto.toUpperCase().replace(/PERÚ/g, 'PERU');

  // Patrón 1: Bloque de 6 caracteres compactos o con guión/espacio central (ej: W2U-792, A1A 123, ABC-123)
  const regexA = /\b([A-Z0-9]{3})[\s\-_.:/]?([A-Z0-9]{3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regexA.exec(t)) !== null) {
    const raw = match[1] + match[2];
    const norm = normalizarPlaca(raw);
    if (norm && esPlacaValida(norm) && !encontradas.has(norm)) {
      encontradas.add(norm);
      candidatos.push({ placa: norm, textoMatch: match[0] });
    }
  }

  // Patrón 2: Letras escritas a mano separadas por espacios (ej: "W 2 U - 7 9 2" o "A 1 A 1 2 3")
  const regexB = /\b([A-Z0-9])\s+([A-Z0-9])\s+([A-Z0-9])\s*[\s\-_.:/]?\s*([A-Z0-9])\s+([A-Z0-9])\s+([A-Z0-9])\b/g;
  while ((match = regexB.exec(t)) !== null) {
    const raw = match[1] + match[2] + match[3] + match[4] + match[5] + match[6];
    const norm = normalizarPlaca(raw);
    if (norm && esPlacaValida(norm) && !encontradas.has(norm)) {
      encontradas.add(norm);
      candidatos.push({ placa: norm, textoMatch: match[0] });
    }
  }

  // Patrón 3: Motos (2 caracteres + 4 dígitos, ej: "AB-1234" o "12-3456")
  const regexMoto = /\b([A-Z0-9]{2})[\s\-_.:/]?([0-9]{4})\b/g;
  while ((match = regexMoto.exec(t)) !== null) {
    const raw = match[1] + match[2];
    const norm = normalizarPlaca(raw);
    if (norm && esPlacaValida(norm) && !encontradas.has(norm)) {
      encontradas.add(norm);
      candidatos.push({ placa: norm, textoMatch: match[0] });
    }
  }

  // Patrón 4: Subsecuencias de 6 caracteres dentro de palabras largas o ruido de OCR
  const palabras = t.split(/\s+/);
  for (const palabra of palabras) {
    const soloAlfanum = palabra.replace(/[^A-Z0-9]/g, '');
    if (soloAlfanum.length >= 6) {
      for (let i = 0; i <= soloAlfanum.length - 6; i++) {
        const sub = soloAlfanum.slice(i, i + 6);
        const norm = normalizarPlaca(sub);
        if (norm && esPlacaValida(norm) && !encontradas.has(norm)) {
          encontradas.add(norm);
          candidatos.push({ placa: norm, textoMatch: palabra });
          break;
        }
      }
    }
  }

  return candidatos;
}

/**
 * Calcula vehículos en tránsito: max(0, en_recinto - ocupados)
 */
export function calcularAutosEnTransito(en_recinto: number, ocupados: number): number {
  return Math.max(0, en_recinto - ocupados);
}

/**
 * Calcula cajones libres: max(0, CAPACIDAD_MAXIMA - ocupados)
 */
export function calcularCajonesLibres(ocupados: number): number {
  return Math.max(0, CAPACIDAD_MAXIMA - ocupados);
}

/**
 * Verifica si se permite el ingreso a un nuevo vehículo
 */
export function puedeIngresar(en_recinto: number, placa: string, movimientosActivos: MovimientoRegistro[]): {
  permitido: boolean;
  motivo?: string;
} {
  if (en_recinto >= CAPACIDAD_MAXIMA) {
    return { permitido: false, motivo: 'Aforo completo (8/8 vehículos en recinto)' };
  }
  const norm = normalizarPlaca(placa);
  if (!norm || !esPlacaValida(norm)) {
    return { permitido: false, motivo: 'Placa no cumple con el formato peruano oficial' };
  }
  const yaDentro = movimientosActivos.some(
    (m) => m.estado === 'DENTRO' && normalizarPlaca(m.placa) === norm
  );
  if (yaDentro) {
    return { permitido: false, motivo: `El vehículo con placa ${norm} ya figura dentro del recinto` };
  }
  return { permitido: true };
}

/**
 * Doble Validación de Seguridad Cruzada: Placa del QR vs Placa leída en Cámara de Salida
 */
export function validarSalidaCruzada(
  placaQR: string,
  placaCamaraSalida: string
): {
  valido: boolean;
  alertaFraude: boolean;
  mensaje: string;
} {
  const normQR = normalizarPlaca(placaQR);
  const normCam = normalizarPlaca(placaCamaraSalida);

  if (!normQR || !normCam) {
    return {
      valido: false,
      alertaFraude: false,
      mensaje: 'Debe proporcionar la lectura del Ticket QR y la placa física de salida.',
    };
  }

  if (normQR === normCam) {
    return {
      valido: true,
      alertaFraude: false,
      mensaje: `Validación exitosa. Placa ${normQR} coincide con Ticket QR.`,
    };
  }

  return {
    valido: false,
    alertaFraude: true,
    mensaje: `ALERTA DE SEGURIDAD: El Ticket QR pertenece a la placa [${normQR}], pero la cámara de salida detecta la placa [${normCam}]`,
  };
}

/**
 * Genera ID único de ticket
 */
export function generarIdTicket(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `TKT-${num}`;
}

/**
 * Calcula duración en minutos entre dos timestamps
 */
export function calcularDuracionMinutos(inicioIso: string, finIso: string): number {
  const t1 = new Date(inicioIso).getTime();
  const t2 = new Date(finIso).getTime();
  const diffMs = Math.max(0, t2 - t1);
  return Math.max(1, Math.round(diffMs / 60000));
}
