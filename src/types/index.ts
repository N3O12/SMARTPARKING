export interface CajonEstado {
  id: string; // 'A1' - 'A4', 'B1' - 'B4'
  ocupado: boolean;
  vehiculo_placa?: string | null;
}

export interface Movimiento {
  id_ticket: string;
  placa: string;
  hora_entrada: string;
  hora_salida: string | null;
  tiempo_estadia_minutos: number | null;
  estado: 'DENTRO' | 'FINALIZADO';
}

export interface EstadoSistema {
  en_recinto: number;
  capacidad_max: number;
  ocupados: number;
  libres: number;
  en_transito: number;
  total_historico: number;
  cajones: CajonEstado[];
  tickets_activos: Array<{
    id_ticket: string;
    placa: string;
    hora_entrada: string;
  }>;
}

export interface TicketQRData {
  id_ticket: string;
  placa: string;
  hora_entrada: string;
}

export interface TicketEmitido {
  exito: boolean;
  id_ticket: string;
  placa: string;
  hora_entrada: string;
  qr_base64: string;
  qr_data: TicketQRData;
  mensaje: string;
  barrera_entrada: string;
}

export interface ValidacionSalidaResultado {
  autorizado: boolean;
  alerta_fraude: boolean;
  mensaje: string;
  barrera_salida: string;
  tiempo_estadia_minutos?: number;
  id_ticket?: string;
  placa?: string;
  hora_salida?: string;
}

export interface OCRResultado {
  placa: string;
  confianza: number;
  bbox?: number[];
  metodo?: string;
  exito?: boolean;
  textoCrudo?: string;
}

export type MensajeLcd =
  | 'ACCESO_DISPONIBLE'
  | 'LEYENDO_PLACA'
  | 'RETIRE_TICKET'
  | 'QR_PLACA_VALIDO'
  | 'ERROR_SEGURIDAD';

export interface FeedbackEntrenamientoPayload {
  imageBase64: string;
  placaCorrecta: string;
  placaDetectada?: string;
  esCorrecta: boolean;
  bbox?: number[];
}

export interface FeedbackStats {
  total_muestras: number;
  total_confirmadas: number;
  total_corregidas: number;
  correcciones: Record<
    string,
    {
      ultima_interaccion: string;
      es_correcta: boolean;
      detectado_previo: string;
      total_muestras: number;
      ultima_imagen?: string;
    }
  >;
  modelo_actual: string;
  listo_para_reentrenar: boolean;
}

