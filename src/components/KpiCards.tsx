import React from 'react';
import {
  Car,
  CheckCircle2,
  Clock,
  History,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

interface KpiCardsProps {
  enRecinto: number;
  capacidadMax: number;
  ocupados: number;
  libres: number;
  enTransito: number;
  totalHistorico: number;
}

export const KpiCards: React.FC<KpiCardsProps> = ({
  enRecinto,
  capacidadMax,
  ocupados,
  libres,
  enTransito,
  totalHistorico,
}) => {
  const porcentajeOcupacion = Math.min(100, Math.round((enRecinto / capacidadMax) * 100));
  const estaLleno = enRecinto >= capacidadMax;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {/* 1. Autos en Recinto */}
      <div
        className={`col-span-2 sm:col-span-1 rounded-xl p-3.5 border transition-all shadow-md relative overflow-hidden ${
          estaLleno
            ? 'bg-rose-950/40 border-rose-600/60 text-rose-100 ring-2 ring-rose-500/30'
            : 'bg-slate-900/80 border-slate-700/70 text-slate-100'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            En Recinto
          </span>
          {estaLleno ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white flex items-center gap-1 animate-pulse">
              <ShieldAlert className="w-3 h-3" />
              LLENO
            </span>
          ) : (
            <Car className="w-4 h-4 text-cyan-400" />
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-black font-mono tracking-tight">
            {enRecinto}
          </span>
          <span className="text-xs text-slate-400 font-mono">/ {capacidadMax} max</span>
        </div>

        {/* Barra de capacidad */}
        <div className="mt-2.5 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              estaLleno
                ? 'bg-rose-500'
                : porcentajeOcupacion > 75
                ? 'bg-amber-500'
                : 'bg-cyan-500'
            }`}
            style={{ width: `${porcentajeOcupacion}%` }}
          />
        </div>
      </div>

      {/* 2. Cajones Ocupados (Rojo) */}
      <div className="bg-slate-900/80 border border-slate-700/70 rounded-xl p-3.5 shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium uppercase tracking-wide">
            Cajones Ocupados
          </span>
          <XCircle className="w-4 h-4 text-rose-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-black font-mono text-rose-400">
            {ocupados}
          </span>
          <span className="text-xs text-slate-400">sensores</span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
          Sensores Ultrasónicos (Rojo)
        </div>
      </div>

      {/* 3. Cajones Libres (Verde) */}
      <div className="bg-slate-900/80 border border-slate-700/70 rounded-xl p-3.5 shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium uppercase tracking-wide">
            Cajones Libres
          </span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-black font-mono text-emerald-400">
            {libres}
          </span>
          <span className="text-xs text-slate-400">disponibles</span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          Espacios listos (Verde)
        </div>
      </div>

      {/* 4. Autos en Tránsito */}
      <div className="bg-slate-900/80 border border-slate-700/70 rounded-xl p-3.5 shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium uppercase tracking-wide">
            En Tránsito
          </span>
          <Clock className="w-4 h-4 text-amber-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-black font-mono text-amber-400">
            {enTransito}
          </span>
          <span className="text-xs text-slate-400">circulando</span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 truncate">
          Entraron sin cajón aún
        </div>
      </div>

      {/* 5. Total Histórico */}
      <div className="bg-slate-900/80 border border-slate-700/70 rounded-xl p-3.5 shadow-md">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium uppercase tracking-wide">
            Total Histórico
          </span>
          <History className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-black font-mono text-indigo-400">
            {totalHistorico}
          </span>
          <span className="text-xs text-slate-400">ingresos</span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 truncate">
          Acumulado en SQLite
        </div>
      </div>
    </div>
  );
};
