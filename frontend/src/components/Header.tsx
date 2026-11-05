import React, { useEffect, useState } from 'react';
import {
  Car,
  Clock,
  Maximize2,
  RefreshCcw,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

interface HeaderProps {
  isBackendOnline: boolean;
  preferLocal: boolean;
  onOpenBackendModal: () => void;
  onOpenTotem: () => void;
  onResetCajones: () => void;
  viewMode?: 'ALPR_ONLY' | 'PARKING';
  onToggleViewMode?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isBackendOnline,
  preferLocal,
  onOpenBackendModal,
  onOpenTotem,
  onResetCajones,
  viewMode = 'ALPR_ONLY',
  onToggleViewMode,
}) => {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="bg-slate-900/95 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md px-4 py-3 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Branding */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white font-mono flex items-center gap-1.5">
                <span>SGE PRO</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-sans font-semibold">
                  v1.0 ALPR
                </span>
              </h1>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Gestión de Estacionamiento Inteligente • Aforo 8 Cajones • Tickets QR &amp; Antirrobo
            </p>
          </div>
        </div>

        {/* Reloj y Acciones */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Reloj Digital */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{time}</span>
          </div>

          {/* Estado de Backend / Píldora de Conexión */}
          <button
            onClick={onOpenBackendModal}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition-all active:scale-95 ${
              isBackendOnline && !preferLocal
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80 hover:bg-emerald-900/90'
                : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-750'
            }`}
            title="Ver configuración del Backend Python FastAPI"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendOnline && !preferLocal
                  ? 'bg-emerald-400 animate-ping'
                  : 'bg-cyan-400'
              }`}
            />
            <span className="hidden sm:inline">
              {preferLocal
                ? 'Motor Local'
                : isBackendOnline
                ? 'FastAPI Conectado'
                : 'Motor Local'}
            </span>
            <Server className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* Conmutador de Modo: ALPR Exclusivo vs Estacionamiento Completo */}
          {onToggleViewMode && (
            <button
              onClick={onToggleViewMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all shadow-sm active:scale-95 ${
                viewMode === 'ALPR_ONLY'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 hover:bg-cyan-500/30'
                  : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-500/30'
              }`}
              title="Alternar entre modo solo cámara ALPR y vista completa del estacionamiento"
            >
              <Car className="w-3.5 h-3.5" />
              <span>{viewMode === 'ALPR_ONLY' ? '📷 Solo Cámara ALPR' : '🚗 Estacionamiento'}</span>
            </button>
          )}

          {/* Botón Modo Tótem */}
          {viewMode === 'PARKING' && (
            <button
              onClick={onOpenTotem}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold border border-slate-700 transition-all shadow-sm active:scale-95"
              title="Abrir Tótem para Conductores en Pantalla Completa"
            >
              <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline">Tótem 2D</span>
            </button>
          )}

          {/* Reiniciar Cajones */}
          {viewMode === 'PARKING' && (
            <button
              onClick={onResetCajones}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              title="Reiniciar sensores de cajones a LIBRE"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
