import React from 'react';
import {
  AlertOctagon,
  BellOff,
  Car,
  Lock,
  QrCode,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';
import { soundManager } from '../utils/audioAlarm';

interface SecurityAlertModalProps {
  alerta: {
    placaQR: string;
    placaCamara: string;
    mensaje: string;
  } | null;
  onClose: () => void;
}

export const SecurityAlertModal: React.FC<SecurityAlertModalProps> = ({
  alerta,
  onClose,
}) => {
  if (!alerta) return null;

  const handleSilenciarYSalir = () => {
    soundManager.stopAlarm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-rose-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-950 border-2 border-rose-600 rounded-2xl shadow-[0_0_50px_rgba(225,29,72,0.6)] overflow-hidden flex flex-col">
        {/* Cabecera de Alerta Estroboscópica Roja */}
        <div className="bg-rose-600 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-white/20 animate-bounce">
              <ShieldAlert className="w-6 h-6 text-white" />
            </span>
            <div>
              <h3 className="text-base font-black uppercase tracking-wider font-mono">
                ¡FRAUDE DETECTADO EN SALIDA!
              </h3>
              <p className="text-xs text-rose-100 font-mono">
                BARRERA DE SALIDA BLOQUEADA • ALARMA ACTIVADA
              </p>
            </div>
          </div>

          <button
            onClick={handleSilenciarYSalir}
            className="p-1.5 rounded-lg bg-white/25 hover:bg-white/40 text-white transition-colors"
            title="Cerrar alerta"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cuerpo de la Alerta con Mensaje Exacto Requerido */}
        <div className="p-6 space-y-4 text-slate-100">
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-700/80 text-rose-200 font-mono text-sm leading-relaxed shadow-inner">
            <p className="font-bold text-rose-100 mb-1 flex items-center gap-2">
              <AlertOctagon className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <span>INCIDENCIA DE SEGURIDAD ANTIRROBO:</span>
            </p>
            <p className="text-xs sm:text-sm pl-7 text-rose-300">
              {alerta.mensaje}
            </p>
          </div>

          {/* Comparativa Gráfica de Discrepancia */}
          <div className="grid grid-cols-2 gap-3">
            {/* Placa del QR */}
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 flex flex-col items-center">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>Ticket QR Escaneado</span>
              </div>
              <span className="text-xl font-black font-mono text-cyan-400 tracking-wider">
                {alerta.placaQR || 'DESCONOCIDO'}
              </span>
              <span className="text-[10px] text-slate-400 mt-1">Registrado al entrar</span>
            </div>

            {/* Placa Detectada en Salida */}
            <div className="p-3 rounded-xl bg-slate-900 border border-rose-500/60 flex flex-col items-center">
              <div className="flex items-center gap-1.5 text-xs text-rose-400 mb-1">
                <Car className="w-3.5 h-3.5 text-rose-400" />
                <span>Cámara 2 (Salida)</span>
              </div>
              <span className="text-xl font-black font-mono text-rose-400 tracking-wider">
                {alerta.placaCamara || 'DESCONOCIDO'}
              </span>
              <span className="text-[10px] text-rose-400/80 mt-1">Vehículo presente</span>
            </div>
          </div>

          {/* Acción de Seguridad Bloqueante */}
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <Lock className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>
              La barrera permanecerá cerrada. Se requiere intervención del personal de seguridad o corrección de la matrícula.
            </span>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-2 justify-end">
          <button
            onClick={() => soundManager.stopAlarm()}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
          >
            <BellOff className="w-3.5 h-3.5 text-slate-400" />
            <span>Silenciar Sirena</span>
          </button>
          <button
            onClick={handleSilenciarYSalir}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md active:scale-95"
          >
            Entendido / Cerrar Alerta
          </button>
        </div>
      </div>
    </div>
  );
};
