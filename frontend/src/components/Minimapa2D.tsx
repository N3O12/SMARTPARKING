import React from 'react';
import {
  Car,
  Maximize2,
  Radio,
  Sparkles,
} from 'lucide-react';
import { CajonEstado } from '../types';

interface Minimapa2DProps {
  cajones: CajonEstado[];
  onToggleCajon: (id: string) => void;
  onOpenTotem: () => void;
}

export const Minimapa2D: React.FC<Minimapa2DProps> = ({
  cajones,
  onToggleCajon,
  onOpenTotem,
}) => {
  const filaA = cajones.filter((c) => c.id.startsWith('A'));
  const filaB = cajones.filter((c) => c.id.startsWith('B'));

  const renderCajon = (cajon: CajonEstado) => {
    const isOccupied = cajon.ocupado;

    return (
      <button
        key={cajon.id}
        onClick={() => onToggleCajon(cajon.id)}
        aria-label={`Cajón ${cajon.id} ${isOccupied ? 'Ocupado' : 'Libre'} - Clic para alternar sensor`}
        className={`group relative flex flex-col items-center justify-between p-2.5 rounded-xl border-2 transition-all duration-300 transform active:scale-95 text-left focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
          isOccupied
            ? 'bg-rose-950/40 border-rose-600/80 hover:bg-rose-900/50 shadow-[0_0_15px_rgba(225,29,72,0.25)]'
            : 'bg-emerald-950/30 border-emerald-500/80 hover:bg-emerald-900/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
        }`}
      >
        {/* Sensor ultrasónico superior con LED emisor */}
        <div className="w-full flex items-center justify-between border-b border-white/10 pb-1">
          <div className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                isOccupied
                  ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                  : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
              }`}
            />
            <span className="text-[10px] font-mono font-bold tracking-wider text-slate-300">
              {cajon.id}
            </span>
          </div>
          <span
            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
              isOccupied
                ? 'bg-rose-900/80 text-rose-200 border border-rose-700/60'
                : 'bg-emerald-900/80 text-emerald-200 border border-emerald-700/60'
            }`}
          >
            {isOccupied ? 'OCUPADO' : 'LIBRE'}
          </span>
        </div>

        {/* Representación visual del vehículo o espacio libre */}
        <div className="my-3 flex flex-col items-center justify-center">
          {isOccupied ? (
            <div className="flex flex-col items-center animate-in fade-in zoom-in duration-200">
              <div className="relative">
                <Car className="w-9 h-9 text-rose-300 drop-shadow-[0_2px_8px_rgba(244,63,94,0.4)]" />
                <span className="absolute -bottom-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
              </div>
              <span className="mt-1 text-[10px] font-mono text-rose-200 bg-rose-950/90 px-1.5 py-0.5 rounded border border-rose-800">
                {cajon.vehiculo_placa || 'DETECTADO'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center opacity-85 group-hover:opacity-100 transition-opacity">
              <div className="w-10 h-7 border border-dashed border-emerald-400/60 rounded flex items-center justify-center bg-emerald-950/20">
                <span className="text-xs font-mono font-bold text-emerald-300">P</span>
              </div>
              <span className="mt-1 text-[10px] text-emerald-300/80">Disponible</span>
            </div>
          )}
        </div>

        {/* Guía de clic para simulación */}
        <div className="w-full text-center text-[9px] font-mono text-slate-400 group-hover:text-cyan-300 transition-colors border-t border-white/5 pt-1">
          Clic para alternar
        </div>
      </button>
    );
  };

  return (
    <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 shadow-xl flex flex-col justify-between">
      {/* Cabecera del Minimapa */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-700/50 text-cyan-400">
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wide">
              Minimapa 2D en Tiempo Real
            </h2>
            <p className="text-[11px] text-slate-400">
              Simulador de sensores ultrasónicos IoT (8 Cajones)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenTotem}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold border border-slate-700 hover:border-slate-600 transition-all shadow-sm active:scale-95"
            title="Abrir vista ampliada de Tótem para conductores"
          >
            <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Modo Tótem Pantalla Completa</span>
          </button>
        </div>
      </div>

      {/* Layout del Parqueo: Fila A, Pasillo Central, Fila B */}
      <div className="mt-4 p-3 bg-slate-950/80 rounded-xl border border-slate-800 relative">
        {/* FILA A (A1 - A4) */}
        <div className="flex items-center justify-between mb-1 text-[11px] font-mono text-slate-400 px-1">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            SECTOR A (Norte)
          </span>
          <span className="text-[10px] text-slate-400">Pared Perimetral</span>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {filaA.map(renderCajon)}
        </div>

        {/* PASILLO CENTRAL (Asfalto, flechas y señalización) */}
        <div className="my-3.5 py-2.5 px-4 bg-slate-900 border-y-2 border-dashed border-amber-400/40 rounded-lg flex items-center justify-between text-xs font-mono text-slate-300 shadow-inner relative overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 text-[10px]">
              VEL. MÁX 10 KM/H
            </span>
            <span className="text-slate-400 hidden sm:inline">PASILLO DE CIRCULACIÓN</span>
          </div>

          <div className="flex items-center gap-3 text-cyan-400 font-bold tracking-widest text-sm">
            <span>&lt;&lt; ENTRADA</span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400">SALIDA &gt;&gt;</span>
          </div>
        </div>

        {/* FILA B (B1 - B4) */}
        <div className="flex items-center justify-between mb-1 text-[11px] font-mono text-slate-400 px-1">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            SECTOR B (Sur)
          </span>
          <span className="text-[10px] text-slate-400">Pared Perimetral</span>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {filaB.map(renderCajon)}
        </div>
      </div>

      {/* Leyenda y Ayuda */}
      <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2 pt-2 border-t border-slate-800">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            Verde = Cajón Libre
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            Rojo = Cajón Ocupado
          </span>
        </div>
        <span className="text-slate-400 flex items-center gap-1 text-[10px]">
          <Sparkles className="w-3 h-3 text-amber-400" />
          Haz clic en cualquier cajón para simular llegada o partida
        </span>
      </div>
    </div>
  );
};
