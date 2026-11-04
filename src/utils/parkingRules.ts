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
export const LETRAS_INICIALES_VALIDAS = new Set([
  'A', 'B', 'C', 'D', 'F', 'H', 'L', 'M', 'P', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
]);

/** Letras y caracteres inválidos en primera posición */
export const PRIMEROS_CARACTERES_INVALIDOS = new Set([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'O', 'Q', 'I', 'Ñ'
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
 * Limpia y normaliza una matrícula aplicando los 3 formatos peruanos autorizados:
 * 1. Autos Estándar: LLL-NNN (ej. X71-962 -> X71-962 o ABC-123)
 * 2. Autos Modernos: LLL-LNN (ej. ABC-X45)
 * 3. Motos: LL-NNNN o 6 caracteres (ej. AB-1234)
 */
export function normalizarPlaca(texto: string): string {
  if (!texto) return '';

  // 1. Omitir deliberadamente palabras fijas y ruidos comunes
  let limpio = texto
    .toUpperCase()
    .replace(/PERU|CHILE|AUTO|STOP|TAXI|MTC/g, '')
    .replace(/[^A-Z0-9]/g, '');

  if (limpio.length < 5) return '';

  // Si tiene más de 6 caracteres (ej. tomó 7), quedarnos con el núcleo de 6 caracteres
  if (limpio.length > 6) {
    limpio = limpio.slice(0, 6);
  }

  // 2. Validación de primer carácter
  const primerChar = limpio[0];
  if (PRIMEROS_CARACTERES_INVALIDOS.has(primerChar) || !LETRAS_INICIALES_VALIDAS.has(primerChar)) {
    // Si el primer carácter fue confundido (ej: un 0 o una O), no es válido como serie peruana
    return '';
  }

  if (limpio.length === 6) {
    // Si ya viene como 3 letras + 3 números
    const estandarMatch = limpio.match(/^([A-Z]{3})([0-9]{3})$/);
    if (estandarMatch) {
      return `${estandarMatch[1]}-${estandarMatch[2]}`;
    }

    // Si viene como 3 letras + 1 letra + 2 números (Moderno)
    const modernoMatch = limpio.match(/^([A-Z]{3})([A-Z][0-9]{2})$/);
    if (modernoMatch) {
      return `${modernoMatch[1]}-${modernoMatch[2]}`;
    }

    // Si viene como 3 caracteres alfanuméricos + 3 alfanuméricos (ej. X71-962 o W1X-942)
    // donde la serie tiene números/letras combinados
    const alfanumMatch = limpio.match(/^([A-Z0-9]{3})([A-Z0-9]{3})$/);
    if (alfanumMatch) {
      return `${alfanumMatch[1]}-${alfanumMatch[2]}`;
    }
  }

  return '';
}

/**
 * Valida si una placa cumple con cualquiera de las estructuras legales peruanas
 */
export function esPlacaValida(placa: string): boolean {
  if (!placa) return false;
  const sinGuion = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sinGuion.length !== 6) return false;

  const primerChar = sinGuion[0];
  if (!LETRAS_INICIALES_VALIDAS.has(primerChar)) return false;

  // Regex 1: Autos y camionetas estándar (3 letras, guion opcional, 3 números)
  const regexAutoEstandar = /^[A-Z]{3}-?[0-9]{3}$/;
  // Regex 2: Autos modernos combinados (3 letras, 1 letra, 2 números)
  const regexAutoModerno = /^[A-Z]{3}-?[A-Z][0-9]{2}$/;
  // Regex 3: Motocicletas (2 caracteres + 4 números)
  const regexMoto = /^[A-Z0-9]{2}-?[0-9]{4}$/;

  return (
    regexAutoEstandar.test(placa) ||
    regexAutoModerno.test(placa) ||
    regexMoto.test(placa) ||
    regexAutoEstandar.test(sinGuion) ||
    regexAutoModerno.test(sinGuion) ||
    regexMoto.test(sinGuion)
  );
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
