import QRCode from 'qrcode';
import {
  CajonEstado,
  EstadoSistema,
  Movimiento,
  OCRResultado,
  TicketEmitido,
  ValidacionSalidaResultado
} from '../types';
import {
  CAJONES_INICIALES,
  CAPACIDAD_MAXIMA,
  calcularAutosEnTransito,
  calcularCajonesLibres,
  calcularDuracionMinutos,
  generarIdTicket,
  normalizarPlaca,
  puedeIngresar,
  validarSalidaCruzada
} from '../utils/parkingRules';
import { reconocerPlacaReal } from '../utils/realOcr';

const STORAGE_KEY_MOVIMIENTOS = 'sge_pro_movimientos_v2';
const STORAGE_KEY_CAJONES = 'sge_pro_cajones_v2';
const STORAGE_KEY_BACKEND_URL = 'sge_pro_backend_url';

const DEFAULT_BACKEND_URL = 'http://localhost:8000';
const STORAGE_KEY_PREFER_LOCAL = 'sge_pro_prefer_local';

class ParkingApiService {
  private backendUrl: string;
  private isBackendOnline: boolean = false;
  private preferLocal: boolean = false;

  constructor() {
    this.backendUrl = localStorage.getItem(STORAGE_KEY_BACKEND_URL) || DEFAULT_BACKEND_URL;
    const isCloudPreview = typeof window !== 'undefined' && 
      !window.location.hostname.includes('localhost') && 
      !window.location.hostname.includes('127.0.0.1');
    const storedPrefer = localStorage.getItem(STORAGE_KEY_PREFER_LOCAL);
    this.preferLocal = storedPrefer !== null ? storedPrefer === 'true' : isCloudPreview;
    this.initializeLocalStorage();
  }

  public getBackendUrl(): string {
    return this.backendUrl;
  }

  public setBackendUrl(url: string): void {
    this.backendUrl = url.replace(/\/$/, '');
    localStorage.setItem(STORAGE_KEY_BACKEND_URL, this.backendUrl);
  }

  public getIsBackendOnline(): boolean {
    return this.isBackendOnline;
  }

  public getPreferLocal(): boolean {
    return this.preferLocal;
  }

  public setPreferLocal(prefer: boolean): void {
    this.preferLocal = prefer;
    localStorage.setItem(STORAGE_KEY_PREFER_LOCAL, prefer ? 'true' : 'false');
  }

  /**
   * Inicializa la base de datos local con datos semilla para una experiencia lista para usar
   */
  private initializeLocalStorage(): void {
    if (!localStorage.getItem(STORAGE_KEY_CAJONES)) {
      const initialCajones: CajonEstado[] = CAJONES_INICIALES.map((c) => ({
        ...c,
        ocupado: false,
        vehiculo_placa: null,
      }));
      localStorage.setItem(STORAGE_KEY_CAJONES, JSON.stringify(initialCajones));
    }

    if (!localStorage.getItem(STORAGE_KEY_MOVIMIENTOS)) {
      const now = new Date();
      const past20Min = new Date(now.getTime() - 22 * 60000).toISOString();
      const past10Min = new Date(now.getTime() - 11 * 60000).toISOString();

      const seedMovimientos: Movimiento[] = [
        {
          id_ticket: 'TKT-849201',
          placa: 'W1X-942',
          hora_entrada: past20Min,
          hora_salida: null,
          tiempo_estadia_minutos: null,
          estado: 'DENTRO',
        },
        {
          id_ticket: 'TKT-312904',
          placa: 'ABC-123',
          hora_entrada: past10Min,
          hora_salida: null,
          tiempo_estadia_minutos: null,
          estado: 'DENTRO',
        },
        {
          id_ticket: 'TKT-194022',
          placa: 'KLP-482',
          hora_entrada: new Date(now.getTime() - 95 * 60000).toISOString(),
          hora_salida: new Date(now.getTime() - 35 * 60000).toISOString(),
          tiempo_estadia_minutos: 60,
          estado: 'FINALIZADO',
        },
      ];
      localStorage.setItem(STORAGE_KEY_MOVIMIENTOS, JSON.stringify(seedMovimientos));

      // Asignar primer vehículo a cajón A1 para consistencia
      const cajones = this.getLocalCajones();
      cajones[0].ocupado = true;
      cajones[0].vehiculo_placa = 'W1X-942';
      this.saveLocalCajones(cajones);
    }
  }

  private getLocalCajones(): CajonEstado[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_CAJONES);
      return data ? JSON.parse(data) : CAJONES_INICIALES;
    } catch {
      return CAJONES_INICIALES;
    }
  }

  private saveLocalCajones(cajones: CajonEstado[]): void {
    localStorage.setItem(STORAGE_KEY_CAJONES, JSON.stringify(cajones));
  }

  private getLocalMovimientos(): Movimiento[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_MOVIMIENTOS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveLocalMovimientos(movimientos: Movimiento[]): void {
    localStorage.setItem(STORAGE_KEY_MOVIMIENTOS, JSON.stringify(movimientos));
  }

  /**
   * Chequea si el backend Python FastAPI está en ejecución en la máquina
   */
  public async checkBackendHealth(): Promise<boolean> {
    if (this.preferLocal) {
      this.isBackendOnline = false;
      return false;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.backendUrl}/`, {
        signal: controller.signal,
        method: 'GET',
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        this.isBackendOnline = true;
        return true;
      }
    } catch {
      this.isBackendOnline = false;
    }
    return false;
  }

  /**
   * Obtiene el estado actual del aforo y cajones
   */
  public async getEstado(): Promise<EstadoSistema> {
    if (this.isBackendOnline && !this.preferLocal) {
      try {
        const res = await fetch(`${this.backendUrl}/api/estado`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        this.isBackendOnline = false;
      }
    }

    // Modo Local
    const cajones = this.getLocalCajones();
    const movimientos = this.getLocalMovimientos();
    const dentro = movimientos.filter((m) => m.estado === 'DENTRO');
    const en_recinto = dentro.length;
    const ocupados = cajones.filter((c) => c.ocupado).length;
    const libres = calcularCajonesLibres(ocupados);
    const en_transito = calcularAutosEnTransito(en_recinto, ocupados);

    return {
      en_recinto,
      capacidad_max: CAPACIDAD_MAXIMA,
      ocupados,
      libres,
      en_transito,
      total_historico: movimientos.length,
      cajones,
      tickets_activos: dentro.map((d) => ({
        id_ticket: d.id_ticket,
        placa: d.placa,
        hora_entrada: d.hora_entrada,
      })),
    };
  }

  /**
   * Alterna el estado del sensor ultrasónico de un cajón
   */
  public async toggleCajon(id: string): Promise<CajonEstado> {
    if (this.isBackendOnline && !this.preferLocal) {
      try {
        const res = await fetch(`${this.backendUrl}/api/cajones/${id}/toggle`, {
          method: 'POST',
        });
        if (res.ok) {
          const data = await res.json();
          return { id: data.id, ocupado: data.ocupado };
        }
      } catch {
        this.isBackendOnline = false;
      }
    }

    // Modo Local
    const cajones = this.getLocalCajones();
    const cajon = cajones.find((c) => c.id.toUpperCase() === id.toUpperCase());
    if (!cajon) throw new Error(`Cajón ${id} no encontrado`);

    cajon.ocupado = !cajon.ocupado;
    if (!cajon.ocupado) {
      cajon.vehiculo_placa = null;
    }
    this.saveLocalCajones(cajones);
    return cajon;
  }

  /**
   * Procesa la lectura de la placa con YOLOv8 + OCR
   */
  public async procesarOCR(imageBase64: string): Promise<OCRResultado> {
    if (this.isBackendOnline && !this.preferLocal) {
      try {
        const res = await fetch(`${this.backendUrl}/api/ocr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: imageBase64 }),
        });
        if (res.ok) {
          const data = await res.json();
          return {
            placa: normalizarPlaca(data.placa || ''),
            confianza: data.confianza || 0.96,
            bbox: data.bbox || [80, 120, 320, 220],
            metodo: data.metodo || 'YOLOv8 + EasyOCR',
            exito: Boolean(data.exito ?? (data.placa && data.placa.length >= 4)),
            textoCrudo: data.texto_crudo,
          };
        }
      } catch {
        this.isBackendOnline = false;
      }
    }

    // Modo Local: Motor de OCR Real sobre el frame de la cámara o imagen
    if (imageBase64 && imageBase64.startsWith('data:image')) {
      try {
        const img = new Image();
        img.src = imageBase64;
        await new Promise((resolve) => {
          if (img.complete) resolve(null);
          else img.onload = () => resolve(null);
        });

        const resReal = await reconocerPlacaReal(img);
        if (resReal.exito && resReal.placa) {
          return {
            placa: resReal.placa,
            confianza: resReal.confianza,
            bbox: [60, 90, 340, 210],
            metodo: resReal.metodo,
            exito: true,
            textoCrudo: resReal.textoCrudo,
          };
        }
      } catch (e) {
        console.warn('Reconocimiento OCR local no detectó texto:', e);
      }
    }

    // Si no hay placa en el encuadre, NO inventar nada
    return {
      placa: '',
      confianza: 0,
      bbox: undefined,
      metodo: 'OCR Real (Sin placa detectada)',
      exito: false,
    };
  }

  /**
   * Flujo de ENTRADA: emite ticket QR y abre barrera
   */
  public async registrarEntrada(placa: string): Promise<TicketEmitido> {
    const norm = normalizarPlaca(placa);
    if (!norm) {
      throw new Error('Debe ingresar o capturar una placa válida.');
    }

    if (this.isBackendOnline && !this.preferLocal) {
      try {
        const res = await fetch(`${this.backendUrl}/api/entrada`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ placa: norm }),
        });
        if (res.ok) {
          const data = await res.json();
          return data;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Error al autorizar entrada');
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('ACCESO DENEGADO')) {
          throw e;
        }
        this.isBackendOnline = false;
      }
    }

    // Modo Local
    const movimientos = this.getLocalMovimientos();
    const dentro = movimientos.filter((m) => m.estado === 'DENTRO');

    const validacion = puedeIngresar(dentro.length, norm, movimientos);
    if (!validacion.permitido) {
      throw new Error(validacion.motivo || 'Ingreso denegado');
    }

    const idTicket = generarIdTicket();
    const ahora = new Date().toISOString();
    const qrPayload = {
      id_ticket: idTicket,
      placa: norm,
      hora_entrada: ahora,
    };

    const qrBase64 = await QRCode.toDataURL(JSON.stringify(qrPayload), {
      width: 320,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    });

    const nuevoMovimiento: Movimiento = {
      id_ticket: idTicket,
      placa: norm,
      hora_entrada: ahora,
      hora_salida: null,
      tiempo_estadia_minutos: null,
      estado: 'DENTRO',
    };

    movimientos.unshift(nuevoMovimiento);
    this.saveLocalMovimientos(movimientos);

    return {
      exito: true,
      id_ticket: idTicket,
      placa: norm,
      hora_entrada: ahora,
      qr_base64: qrBase64,
      qr_data: qrPayload,
      mensaje: `Ingreso autorizado para ${norm}. Retire su ticket.`,
      barrera_entrada: 'ABIERTA',
    };
  }

  /**
   * Flujo de SALIDA: doble validación cruzada antirrobo (QR + Cámara Salida)
   */
  public async registrarSalida(
    idTicket: string,
    placaQR: string,
    placaCamara: string
  ): Promise<ValidacionSalidaResultado> {
    if (this.isBackendOnline && !this.preferLocal) {
      try {
        const res = await fetch(`${this.backendUrl}/api/salida`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id_ticket: idTicket,
            placa_qr: placaQR,
            placa_camara: placaCamara,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          return data;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Error en validación de salida');
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('ALERTA')) {
          throw e;
        }
        this.isBackendOnline = false;
      }
    }

    // Modo Local
    const crossCheck = validarSalidaCruzada(placaQR, placaCamara);

    if (!crossCheck.valido) {
      return {
        autorizado: false,
        alerta_fraude: crossCheck.alertaFraude,
        mensaje: crossCheck.mensaje,
        barrera_salida: 'CERRADA_BLOQUEADA',
      };
    }

    const movimientos = this.getLocalMovimientos();
    const index = movimientos.findIndex(
      (m) => m.id_ticket === idTicket && m.estado === 'DENTRO'
    );

    if (index === -1) {
      return {
        autorizado: false,
        alerta_fraude: false,
        mensaje: `No se encontró un ticket activo con ID: ${idTicket}`,
        barrera_salida: 'CERRADA',
      };
    }

    const ahora = new Date().toISOString();
    const duracion = calcularDuracionMinutos(movimientos[index].hora_entrada, ahora);

    movimientos[index].hora_salida = ahora;
    movimientos[index].tiempo_estadia_minutos = duracion;
    movimientos[index].estado = 'FINALIZADO';

    this.saveLocalMovimientos(movimientos);

    return {
      autorizado: true,
      alerta_fraude: false,
      mensaje: `Salida autorizada para placa ${normalizarPlaca(placaCamara)}. ¡Buen viaje!`,
      barrera_salida: 'ABIERTA',
      tiempo_estadia_minutos: duracion,
      id_ticket: idTicket,
      placa: normalizarPlaca(placaCamara),
      hora_salida: ahora,
    };
  }

  /**
   * Obtiene la lista histórica de movimientos
   */
  public async getMovimientos(filtroPlaca = '', filtroEstado = 'TODOS'): Promise<Movimiento[]> {
    if (this.isBackendOnline && !this.preferLocal) {
      try {
        const params = new URLSearchParams();
        if (filtroPlaca) params.set('placa', filtroPlaca);
        if (filtroEstado) params.set('estado', filtroEstado);

        const res = await fetch(`${this.backendUrl}/api/movimientos?${params.toString()}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        this.isBackendOnline = false;
      }
    }

    // Modo Local
    let list = this.getLocalMovimientos();
    if (filtroPlaca.trim()) {
      const q = filtroPlaca.toUpperCase().replace(/[^A-Z0-9]/g, '');
      list = list.filter((m) => m.placa.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(q));
    }
    if (filtroEstado && filtroEstado !== 'TODOS') {
      list = list.filter((m) => m.estado === filtroEstado);
    }
    return list;
  }

  /**
   * Exporta a archivo CSV
   */
  public exportarCSV(movimientos: Movimiento[]): void {
    const headers = ['ID Ticket', 'Placa', 'Hora Entrada', 'Hora Salida', 'Duración (Min)', 'Estado'];
    const rows = movimientos.map((m) => [
      m.id_ticket,
      m.placa,
      new Date(m.hora_entrada).toLocaleString(),
      m.hora_salida ? new Date(m.hora_salida).toLocaleString() : 'En Recinto',
      m.tiempo_estadia_minutos !== null ? m.tiempo_estadia_minutos.toString() : 'En curso',
      m.estado,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `SGE_Pro_Historial_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Reinicia simulación de cajones a libres
   */
  public async resetCajones(): Promise<void> {
    if (this.isBackendOnline && !this.preferLocal) {
      try {
        await fetch(`${this.backendUrl}/api/reset`, { method: 'POST' });
      } catch {
        this.isBackendOnline = false;
      }
    }
    const cajones = this.getLocalCajones().map((c) => ({
      ...c,
      ocupado: false,
      vehiculo_placa: null,
    }));
    this.saveLocalCajones(cajones);
  }
}

export const parkingApi = new ParkingApiService();
