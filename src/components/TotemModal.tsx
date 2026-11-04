import React from 'react';
import {
  Car,
  CheckCircle2,
  Minimize2,
  Radio,
  X,
  XCircle,
} from 'lucide-react';
import { CajonEstado } from '../types';

interface TotemModalProps {
  isOpen: boolean;
  onClose: () => void;
  cajones: CajonEstado[];
  enRecinto: number;
  capacidadMax: number;
  onToggleCajon: (id: string) => void;
}

export const TotemModal: React.FC<TotemModalProps> = ({
  isOpen,
  onClose,
  cajones,
  enRecinto,
  capacidadMax,
  onToggleCajon,
}) => {
  if (!isOpen) return null;

  const filaA = cajones.filter((c) => c.id.startsWith('A'));
  const filaB = cajones.filter((c) => c.id.startsWith('B'));

  const ocupados = cajones.filter((c) => c.ocupado).length;
  const libres = Math.max(0, capacidadMax - ocupados);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 p-4 sm:p-8 animate-in fade-in duration-200 overflow-y-auto">
      {/* Barra superior de Tótem */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-600/20 border border-cyan-500/40 text-cyan-400">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black font-mono tracking-wider text-white">
              TÓTEM INFORMATIVO DE ACCESO
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-mono">
              Pantalla de guiado vehicular para conductores en puerta de entrada
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm border border-slate-700 transition-all shadow-md active:scale-95"
        >
          <Minimize2 className="w-4 h-4 text-cyan-400" />
          <span>Salir de Pantalla Completa</span>
        </button>
      </div>

      {/* Indicadores en grande para conductores */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-slate-400 uppercase">Capacidad Total</span>
            <div className="text-3xl font-black font-mono text-slate-200 mt-1">{capacidadMax} Cajones</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-600/60 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-emerald-400 uppercase">Espacios Libres</span>
            <div className="text-4xl font-black font-mono text-emerald-300 mt-1">{libres}</div>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-400 opacity-80" />
        </div>

        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-600/60 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-rose-400 uppercase">Espacios Ocupados</span>
            <div className="text-4xl font-black font-mono text-rose-300 mt-1">{ocupados}</div>
          </div>
          <XCircle className="w-8 h-8 text-rose-400 opacity-80" />
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-cyan-400 uppercase">Estado General</span>
            <div className="text-2xl font-black font-mono text-white mt-1">
              {libres > 0 ? 'DISPONIBLE' : 'COMPLETO'}
            </div>
          </div>
        </div>
      </div>

      {/* Minimapa Ampliado de 8 Cajones */}
      <div className="mt-8 flex-1 p-6 bg-slate-900/90 rounded-2xl border-2 border-slate-800 shadow-2xl flex flex-col justify-center">
        {/* FILA A */}
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2 px-2">
          <span>SECTOR A (NORTE)</span>
          <span>SENSORES ULTRASÓNICOS EN TIEMPO REAL</span>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {filaA.map((c) => (
            <button
              key={c.id}
              onClick={() => onToggleCajon(c.id)}
              className={`p-6 rounded-2xl border-4 flex flex-col items-center justify-between transition-all duration-300 transform active:scale-95 shadow-xl ${
                c.ocupado
                  ? 'bg-rose-950/60 border-rose-600 text-rose-200'
                  : 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
              }`}
            >
              <div className="w-full flex justify-between items-center text-xs font-mono font-bold">
                <span className="text-lg font-black">{c.id}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-black/40">
                  {c.ocupado ? 'OCUPADO' : 'LIBRE'}
                </span>
              </div>
              <div className="my-6">
                {c.ocupado ? (
                  <Car className="w-16 h-16 text-rose-400 drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]" />
                ) : (
                  <div className="w-16 h-14 border-2 border-dashed border-emerald-400 rounded-xl flex items-center justify-center text-2xl font-black font-mono text-emerald-300">
                    P
                  </div>
                )}
              </div>
              <span className="text-xs font-mono opacity-80">
                {c.ocupado ? c.vehiculo_placa || 'Vehículo presente' : 'Disponible para aparcar'}
              </span>
            </button>
          ))}
        </div>

        {/* PASILLO CENTRAL */}
        <div className="my-6 py-4 px-6 bg-slate-950 border-y-4 border-dashed border-amber-400/50 rounded-xl flex items-center justify-between font-mono text-amber-300 text-sm font-bold shadow-inner">
          <span className="text-cyan-400 text-base">&lt;&lt; ENTRADA VEHICULAR</span>
          <span className="text-slate-400">PASILLO DE CIRCULACIÓN PRINCIPAL (MÁX 10 KM/H)</span>
          <span className="text-amber-400 text-base">SALIDA &gt;&gt;</span>
        </div>

        {/* FILA B */}
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2 px-2">
          <span>SECTOR B (SUR)</span>
          <span>SENSORES ULTRASÓNICOS EN TIEMPO REAL</span>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {filaB.map((c) => (
            <button
              key={c.id}
              onClick={() => onToggleCajon(c.id)}
              className={`p-6 rounded-2xl border-4 flex flex-col items-center justify-between transition-all duration-300 transform active:scale-95 shadow-xl ${
                c.ocupado
                  ? 'bg-rose-950/60 border-rose-600 text-rose-200'
                  : 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
              }`}
            >
              <div className="w-full flex justify-between items-center text-xs font-mono font-bold">
                <span className="text-lg font-black">{c.id}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-black/40">
                  {c.ocupado ? 'OCUPADO' : 'LIBRE'}
                </span>
              </div>
              <div className="my-6">
                {c.ocupado ? (
                  <Car className="w-16 h-16 text-rose-400 drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]" />
                ) : (
                  <div className="w-16 h-14 border-2 border-dashed border-emerald-400 rounded-xl flex items-center justify-center text-2xl font-black font-mono text-emerald-300">
                    P
                  </div>
                )}
              </div>
              <span className="text-xs font-mono opacity-80">
                {c.ocupado ? c.vehiculo_placa || 'Vehículo presente' : 'Disponible para aparcar'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
