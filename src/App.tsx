import React, { useCallback, useEffect, useState } from 'react';
import {
  CajonEstado,
  EstadoSistema,
  MensajeLcd,
  Movimiento,
  TicketEmitido,
  ValidacionSalidaResultado,
} from './types';
import { parkingApi } from './services/api';
import { Header } from './components/Header';
import { KpiCards } from './components/KpiCards';
import { VirtualLcd } from './components/VirtualLcd';
import { Minimapa2D } from './components/Minimapa2D';
import { CameraStation } from './components/CameraStation';
import { MovementsTable } from './components/MovementsTable';
import { TicketModal } from './components/TicketModal';
import { SecurityAlertModal } from './components/SecurityAlertModal';
import { TotemModal } from './components/TotemModal';
import { BackendModal } from './components/BackendModal';
import { AlprTrainingStation } from './components/AlprTrainingStation';
import { soundManager } from './utils/audioAlarm';

export default function App() {
  // Estado global del sistema
  const [estado, setEstado] = useState<EstadoSistema>({
    en_recinto: 2,
    capacidad_max: 8,
    ocupados: 1,
    libres: 7,
    en_transito: 1,
    total_historico: 3,
    cajones: [],
    tickets_activos: [],
  });

  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [filtroPlaca, setFiltroPlaca] = useState<string>('');
  const [filtroEstado, setFiltroEstado] = useState<string>('TODOS');

  // Estado del display LCD 16x2
  const [lcdMensaje, setLcdMensaje] = useState<MensajeLcd>('ACCESO_DISPONIBLE');

  // Modales
  const [ticketEmitido, setTicketEmitido] = useState<TicketEmitido | null>(null);
  const [alertaSeguridad, setAlertaSeguridad] = useState<{
    placaQR: string;
    placaCamara: string;
    mensaje: string;
  } | null>(null);
  const [isTotemOpen, setIsTotemOpen] = useState<boolean>(false);
  const [isBackendModalOpen, setIsBackendModalOpen] = useState<boolean>(false);

  // Estado de conexión a backend FastAPI
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  const [preferLocal, setPreferLocal] = useState<boolean>(parkingApi.getPreferLocal());

  // Modo de visualización: 'ALPR_ONLY' (calibración y auto-entrenamiento cámara) o 'PARKING' (sistema completo)
  const [viewMode, setViewMode] = useState<'ALPR_ONLY' | 'PARKING'>('ALPR_ONLY');

  // Cargar estado inicial y movimientos
  const fetchDatos = useCallback(async () => {
    try {
      const nuevoEstado = await parkingApi.getEstado();
      setEstado(nuevoEstado);

      const listaMov = await parkingApi.getMovimientos(filtroPlaca, filtroEstado);
      setMovimientos(listaMov);
    } catch (e) {
      console.error('Error obteniendo estado del sistema:', e);
    }
  }, [filtroPlaca, filtroEstado]);

  const checkHealth = useCallback(async () => {
    const online = await parkingApi.checkBackendHealth();
    setIsBackendOnline(online);
  }, []);

  useEffect(() => {
    fetchDatos();
    checkHealth();

    // Sondeo suave cada 5 segundos para mantener sincronización
    const interval = setInterval(() => {
      fetchDatos();
      checkHealth();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchDatos, checkHealth]);

  // Alternar sensor ultrasónico de un cajón
  const handleToggleCajon = async (id: string) => {
    try {
      await parkingApi.toggleCajon(id);
      soundManager.playScanBeep();
      await fetchDatos();
    } catch (err: unknown) {
      console.error(err);
    }
  };

  // Procesar OCR con OpenCV / EasyOCR o fallback inteligente
  const handleProcesarOCR = async (imageBase64: string) => {
    const res = await parkingApi.procesarOCR(imageBase64);
    return res;
  };

  // Flujo Entrada: Emitir Ticket QR
  const handleEmitirEntrada = async (placa: string) => {
    const ticket = await parkingApi.registrarEntrada(placa);
    await fetchDatos();
    return ticket;
  };

  // Flujo Salida: Validación Doble Factor Antirrobo
  const handleValidarSalida = async (
    idTicket: string,
    placaQR: string,
    placaCamara: string
  ): Promise<ValidacionSalidaResultado> => {
    const res = await parkingApi.registrarSalida(idTicket, placaQR, placaCamara);
    await fetchDatos();
    return res;
  };

  // Exportar a CSV
  const handleExportCSV = () => {
    parkingApi.exportarCSV(movimientos);
  };

  // Reiniciar cajones
  const handleResetCajones = async () => {
    if (window.confirm('¿Deseas reiniciar los sensores de todos los cajones a LIBRE?')) {
      await parkingApi.resetCajones();
      await fetchDatos();
    }
  };

  // Cargar ticket desde la tabla o modal hacia el panel de salida
  const handleCargarEnSalida = (tktId: string, placa: string) => {
    // Al seleccionar el ticket en el dropdown, la Cámara 2 lo actualiza automáticamente
    const el = document.getElementById('camera-station-section');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      {/* 1. Header con estado y accesos directos */}
      <Header
        isBackendOnline={isBackendOnline}
        preferLocal={preferLocal}
        onOpenBackendModal={() => setIsBackendModalOpen(true)}
        onOpenTotem={() => setIsTotemOpen(true)}
        onResetCajones={handleResetCajones}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode((v) => (v === 'ALPR_ONLY' ? 'PARKING' : 'ALPR_ONLY'))}
      />

      {/* Contenido Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 space-y-5">
        {viewMode === 'ALPR_ONLY' ? (
          /* MODO EXCLUSIVO: CÁMARA ALPR, CONFIRMACIÓN Y AUTO-ENTRENAMIENTO */
          <AlprTrainingStation
            onProcesarOCR={handleProcesarOCR}
            onVolverEstacionamiento={() => setViewMode('PARKING')}
            isBackendOnline={isBackendOnline}
          />
        ) : (
          /* MODO ESTACIONAMIENTO COMPLETO */
          <>
            {/* FILA 1: KPIs de Aforo + Pantalla LCD 16x2 */}
            <div className="space-y-3">
              <KpiCards
                enRecinto={estado.en_recinto}
                capacidadMax={estado.capacidad_max}
                ocupados={estado.ocupados}
                libres={estado.libres}
                enTransito={estado.en_transito}
                totalHistorico={estado.total_historico}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Pantalla LCD Virtual 16x2 I2C */}
                <div className="md:col-span-1">
                  <VirtualLcd mensajeKey={lcdMensaje} />
                </div>

                {/* Minimapa 2D Interactivo de 8 Cajones */}
                <div className="md:col-span-2">
                  <Minimapa2D
                    cajones={estado.cajones}
                    onToggleCajon={handleToggleCajon}
                    onOpenTotem={() => setIsTotemOpen(true)}
                  />
                </div>
              </div>
            </div>

            {/* FILA 2: Estación de Cámaras (Cámara 1 Entrada + OCR & Cámara 2 Salida + Doble Factor) */}
            <div id="camera-station-section">
              <CameraStation
                enRecinto={estado.en_recinto}
                capacidadMax={estado.capacidad_max}
                ticketsActivos={estado.tickets_activos}
                onProcesarOCR={handleProcesarOCR}
                onEmitirEntrada={handleEmitirEntrada}
                onValidarSalida={handleValidarSalida}
                onSetLcdMensaje={setLcdMensaje}
                onTicketGenerado={(tkt) => setTicketEmitido(tkt)}
                onAlertaFraude={(alerta) => setAlertaSeguridad(alerta)}
              />
            </div>

            {/* FILA 3: Historial de Movimientos en Tiempo Real (SQLite) */}
            <MovementsTable
              movimientos={movimientos}
              filtroPlaca={filtroPlaca}
              filtroEstado={filtroEstado}
              onFiltroPlacaChange={setFiltroPlaca}
              onFiltroEstadoChange={setFiltroEstado}
              onRefresh={fetchDatos}
              onExportCSV={handleExportCSV}
              onCargarEnSalida={handleCargarEnSalida}
            />
          </>
        )}
      </main>

      {/* Footer informativo */}
      <footer className="bg-slate-950 border-t border-slate-900 py-3 text-center text-xs text-slate-500 font-mono">
        SGE Pro © 2026 • Sistema de Gestión de Estacionamiento Inteligente • FastAPI + SQLite + OpenCV + EasyOCR
      </footer>

      {/* MODALES DEL SISTEMA */}
      {/* 1. Modal Ticket Digital Emitido con QR Real */}
      <TicketModal
        ticket={ticketEmitido}
        onClose={() => setTicketEmitido(null)}
        onCargarEnSalida={handleCargarEnSalida}
      />

      {/* 2. Modal Alerta Roja de Seguridad (Fraude / Placa no coincide con Ticket) */}
      <SecurityAlertModal
        alerta={alertaSeguridad}
        onClose={() => setAlertaSeguridad(null)}
      />

      {/* 3. Modo Tótem Pantalla Completa para Conductores */}
      <TotemModal
        isOpen={isTotemOpen}
        onClose={() => setIsTotemOpen(false)}
        cajones={estado.cajones}
        enRecinto={estado.en_recinto}
        capacidadMax={estado.capacidad_max}
        onToggleCajon={handleToggleCajon}
      />

      {/* 4. Modal Configuración FastAPI y Comandos de Terminal */}
      <BackendModal
        isOpen={isBackendModalOpen}
        onClose={() => setIsBackendModalOpen(false)}
        isBackendOnline={isBackendOnline}
        preferLocal={preferLocal}
        onTogglePreferLocal={() => {
          const next = !preferLocal;
          setPreferLocal(next);
          parkingApi.setPreferLocal(next);
          fetchDatos();
        }}
        onCheckHealth={checkHealth}
      />
    </div>
  );
}
