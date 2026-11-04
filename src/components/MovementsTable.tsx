import React, { useState } from 'react';
import {
  ArrowDownUp,
  Clock,
  Download,
  Filter,
  RefreshCw,
  Search,
  Table as TableIcon,
} from 'lucide-react';
import { Movimiento } from '../types';

interface MovementsTableProps {
  movimientos: Movimiento[];
  filtroPlaca: string;
  filtroEstado: string;
  onFiltroPlacaChange: (val: string) => void;
  onFiltroEstadoChange: (val: string) => void;
  onRefresh: () => void;
  onExportCSV: () => void;
  onCargarEnSalida?: (tktId: string, placa: string) => void;
}

export const MovementsTable: React.FC<MovementsTableProps> = ({
  movimientos,
  filtroPlaca,
  filtroEstado,
  onFiltroPlacaChange,
  onFiltroEstadoChange,
  onRefresh,
  onExportCSV,
  onCargarEnSalida,
}) => {
  return (
    <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 shadow-xl">
      {/* Cabecera y Controles de Filtro */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-950/80 border border-indigo-700/50 text-indigo-400">
            <TableIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
              Historial de Movimientos en Tiempo Real (SQLite)
            </h3>
            <p className="text-[11px] text-slate-400">
              Registros persistentes de accesos, tickets y duraciones
            </p>
          </div>
        </div>

        {/* Filtros y Exportación */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Búsqueda por Placa */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={filtroPlaca}
              onChange={(e) => onFiltroPlacaChange(e.target.value)}
              placeholder="Buscar por placa..."
              className="bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 font-mono uppercase focus:outline-none focus:ring-1 focus:ring-cyan-500 w-36 sm:w-44"
            />
          </div>

          {/* Filtro por Estado */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
            <Filter className="w-3 h-3 text-slate-400" />
            <select
              aria-label="Filtrar movimientos por estado"
              value={filtroEstado}
              onChange={(e) => onFiltroEstadoChange(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="TODOS" className="bg-slate-900">Todos los Estados</option>
              <option value="DENTRO" className="bg-slate-900">En Recinto (DENTRO)</option>
              <option value="FINALIZADO" className="bg-slate-900">Finalizados</option>
            </select>
          </div>

          {/* Botón Refrescar */}
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Actualizar tabla"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Botón Exportar CSV */}
          <button
            onClick={onExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-sm active:scale-95"
            title="Descargar archivo CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Tabla con scroll horizontal responsivo */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
            <tr>
              <th className="py-2.5 px-3">ID Ticket</th>
              <th className="py-2.5 px-3">Matrícula (Placa)</th>
              <th className="py-2.5 px-3">Hora Entrada</th>
              <th className="py-2.5 px-3">Hora Salida</th>
              <th className="py-2.5 px-3">Duración</th>
              <th className="py-2.5 px-3">Estado</th>
              <th className="py-2.5 px-3 text-right">Acción Rápida</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 bg-slate-900/50">
            {movimientos.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500 text-xs">
                  No se encontraron movimientos registrados con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              movimientos.map((m) => {
                const isDentro = m.estado === 'DENTRO';
                return (
                  <tr
                    key={m.id_ticket}
                    className="hover:bg-slate-800/60 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-bold text-slate-200">
                      {m.id_ticket}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded font-black bg-slate-800 text-cyan-300 border border-slate-700 tracking-wider">
                        {m.placa}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">
                      {new Date(m.hora_entrada).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      {m.hora_salida ? new Date(m.hora_salida).toLocaleString() : (
                        <span className="text-amber-400 italic">En Recinto</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">
                      {m.tiempo_estadia_minutos !== null ? (
                        <span className="font-semibold text-slate-200">
                          {m.tiempo_estadia_minutos} min
                        </span>
                      ) : (
                        <span className="text-slate-500">En curso</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isDentro
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isDentro ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                          }`}
                        />
                        {m.estado}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {isDentro && onCargarEnSalida && (
                        <button
                          onClick={() => onCargarEnSalida(m.id_ticket, m.placa)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 text-[10px] font-bold border border-slate-700 transition-colors"
                          title="Cargar este ticket en la Cámara de Salida para validar"
                        >
                          Probar Salida
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
