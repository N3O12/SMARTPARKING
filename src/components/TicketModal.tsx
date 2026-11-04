import React, { useRef } from 'react';
import {
  Car,
  CheckCircle,
  Download,
  Printer,
  QrCode,
  Sparkles,
  X,
} from 'lucide-react';
import { TicketEmitido } from '../types';

interface TicketModalProps {
  ticket: TicketEmitido | null;
  onClose: () => void;
  onCargarEnSalida?: (tktId: string, placa: string) => void;
}

export const TicketModal: React.FC<TicketModalProps> = ({
  ticket,
  onClose,
  onCargarEnSalida,
}) => {
  const ticketRef = useRef<HTMLDivElement | null>(null);

  if (!ticket) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!ticket.qr_base64) return;
    const link = document.createElement('a');
    link.href = ticket.qr_base64;
    link.download = `Ticket_${ticket.id_ticket}_${ticket.placa}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Barra superior de acciones */}
        <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 font-bold">
            <CheckCircle className="w-4 h-4" />
            <span>TICKET EMITIDO CON ÉXITO</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* TICKET TÉRMICO FÍSICO / DIGITAL */}
        <div className="p-5 flex flex-col items-center text-center bg-white text-slate-900 select-none">
          <div className="w-full flex items-center justify-between border-b-2 border-dashed border-slate-300 pb-2 mb-3">
            <div className="text-left">
              <h4 className="font-black text-sm tracking-wider font-mono">SGE PRO PARKING</h4>
              <p className="text-[10px] text-slate-500 font-mono">CONTROL DE ACCESO ALPR</p>
            </div>
            <div className="text-right">
              <span className="font-mono text-xs font-bold text-slate-800">
                {ticket.id_ticket}
              </span>
              <p className="text-[9px] text-slate-500 font-mono">I2C / TOTEM</p>
            </div>
          </div>

          {/* Placa Destacada */}
          <div className="my-1 py-1.5 px-4 rounded border-2 border-slate-800 bg-slate-100 w-full max-w-xs">
            <span className="text-[9px] font-mono text-slate-500 block uppercase">
              Matrícula Registrada
            </span>
            <span className="text-2xl font-black font-mono tracking-widest text-slate-900">
              {ticket.placa}
            </span>
          </div>

          {/* Código QR Real generado */}
          <div className="my-3 p-2 bg-white rounded-lg border border-slate-300 shadow-sm">
            {ticket.qr_base64 ? (
              <img
                src={ticket.qr_base64}
                alt={`Código QR Ticket ${ticket.id_ticket}`}
                className="w-44 h-44 object-contain"
              />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center bg-slate-100 text-xs text-slate-400">
                Generando QR...
              </div>
            )}
          </div>

          <div className="text-xs font-mono text-slate-600 space-y-0.5 w-full border-t border-dashed border-slate-300 pt-2">
            <div className="flex justify-between">
              <span>ENTRADA:</span>
              <span className="font-bold text-slate-900">
                {new Date(ticket.hora_entrada).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>FECHA:</span>
              <span>{new Date(ticket.hora_entrada).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 pt-1">
              <span>DOBLE VALIDACIÓN:</span>
              <span className="font-bold">QR + CÁMARA SALIDA</span>
            </div>
          </div>

          {/* Borde simulado de corte de ticket térmico */}
          <div className="mt-4 w-full flex justify-between overflow-hidden opacity-30">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} className="text-xs font-mono">▲</span>
            ))}
          </div>
        </div>

        {/* Acciones del Modal */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDownload}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Descargar PNG</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-slate-300" />
              <span>Imprimir</span>
            </button>
          </div>

          {onCargarEnSalida && (
            <button
              onClick={() => {
                onCargarEnSalida(ticket.id_ticket, ticket.placa);
                onClose();
              }}
              className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Probar este ticket en Cámara de Salida</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
