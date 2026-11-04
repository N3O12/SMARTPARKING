/**
 * Reglas de negocio y cálculos puros para SGE Pro
 */

export interface CajonEstado {
  id: string; // 'A1' - 'A4', 'B1' - 'B4'
  ocupado: boolean;
  vehiculo_placa?: string | null;
}

export interface MovimientoRegistro {
  id_ticket: string;
  placa: string;
  hora_entrada: string; // ISO string o formato legible
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

/**
 * Limpia y normaliza una matrícula vehicular a formato estándar alfanumérico (ej: W1X-942 o ABC-123)
 */
export function normalizarPlaca(texto: string): string {
  if (!texto) return '';
  // Remover caracteres especiales salvo guion, pasar a mayúsculas
  const limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (limpio.length >= 6) {
    // Si tiene 6 o 7 caracteres, colocar guion común de formato latinoamericano XXX-XXX
    const parte1 = limpio.slice(0, 3);
    const parte2 = limpio.slice(3, 7);
    return `${parte1}-${parte2}`;
  }
  return limpio;
}

/**
 * Valida si el formato de placa es aceptable
 */
export function esPlacaValida(placa: string): boolean {
  const norm = normalizarPlaca(placa);
  const regex = /^[A-Z0-9]{3}-[A-Z0-9]{3,4}$/;
  return regex.test(norm) || (norm.length >= 5 && norm.length <= 8);
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
  if (!norm) {
    return { permitido: false, motivo: 'Placa no válida' };
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
