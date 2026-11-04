import React from 'react';
import { Cpu } from 'lucide-react';
import { MensajeLcd } from '../types';

interface VirtualLcdProps {
  mensajeKey: MensajeLcd;
}

export const VirtualLcd: React.FC<VirtualLcdProps> = ({ mensajeKey }) => {
  // Mapeo exacto de los mensajes operativos solicitados de 16x2 caracteres
  const getLineas = (): { linea1: string; linea2: string } => {
    switch (mensajeKey) {
      case 'LEYENDO_PLACA':
        return {
          linea1: 'LEYENDO PLACA...',
          linea2: 'ESPERE UN MOM...',
        };
      case 'RETIRE_TICKET':
        return {
          linea1: 'RETIRE TICKET QR',
          linea2: 'BARRERA ABIERTA ',
        };
      case 'QR_PLACA_VALIDO':
        return {
          linea1: 'QR+PLACA VALIDO ',
          linea2: 'SALIDA LIBRE -> ',
        };
      case 'ERROR_SEGURIDAD':
        return {
          linea1: 'ERROR SEGURIDAD!',
          linea2: 'PLACA != TICKET ',
        };
      case 'ACCESO_DISPONIBLE':
      default:
        return {
          linea1: 'ACCESO DISPONIB.',
          linea2: 'MIRE MAPA 2D -> ',
        };
    }
  };

  const { linea1, linea2 } = getLineas();

  // Asegurar que cada línea tenga exactamente 16 caracteres para simular LCD 16x2 fielmente
  const pad16 = (txt: string) => txt.slice(0, 16).padEnd(16, ' ');

  const esError = mensajeKey === 'ERROR_SEGURIDAD';

  return (
    <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 shadow-lg flex flex-col justify-between">
      <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-mono tracking-wider font-semibold text-slate-300">PANTALLA LCD 16x2 (I2C)</span>
        </div>
        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
          ADDR 0x27 • 5V
        </span>
      </div>

      {/* Pantalla Física LCD con retroiluminación azul / roja en error */}
      <div className="mt-2.5 p-3 rounded-lg border-2 border-slate-950 shadow-inner relative overflow-hidden transition-colors duration-300"
        style={{
          backgroundColor: esError ? '#450a0a' : '#042f2e',
          boxShadow: esError
            ? 'inset 0 0 15px rgba(239, 68, 68, 0.4)'
            : 'inset 0 0 15px rgba(20, 184, 166, 0.35)',
        }}
      >
        {/* Grilla sutil de matriz de puntos */}
        <div
          className="font-mono text-sm sm:text-base font-bold tracking-widest select-none leading-relaxed"
          style={{
            fontFamily: '"Courier New", Courier, monospace',
            color: esError ? '#fca5a5' : '#5eead4',
            textShadow: esError
              ? '0 0 8px rgba(248, 113, 113, 0.8)'
              : '0 0 8px rgba(45, 212, 191, 0.8)',
          }}
        >
          <div className="whitespace-pre flex justify-between border-b border-dashed border-white/10 pb-1">
            <span>{pad16(linea1)}</span>
          </div>
          <div className="whitespace-pre flex justify-between pt-1">
            <span>{pad16(linea2)}</span>
          </div>
        </div>

        {/* LED indicador de estado del módulo I2C */}
        <div className="absolute top-1.5 right-2 flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full animate-ping ${
              esError ? 'bg-red-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              esError ? 'bg-red-500' : 'bg-emerald-500'
            }`}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>Display Operativo Entrada</span>
        <span className="font-mono text-[10px] text-slate-400">Sin conteos • Guiado visual</span>
      </div>
    </div>
  );
};
