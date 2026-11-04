import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Folder,
  Globe,
  Radio,
  Server,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { parkingApi } from '../services/api';

interface BackendModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBackendOnline: boolean;
  preferLocal: boolean;
  onTogglePreferLocal: () => void;
  onCheckHealth: () => void;
}

export const BackendModal: React.FC<BackendModalProps> = ({
  isOpen,
  onClose,
  isBackendOnline,
  preferLocal,
  onTogglePreferLocal,
  onCheckHealth,
}) => {
  const [backendUrlInput, setBackendUrlInput] = useState<string>(parkingApi.getBackendUrl());
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleSaveUrl = () => {
    parkingApi.setBackendUrl(backendUrlInput);
    onCheckHealth();
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const commandSteps = [
    {
      title: '1. Entrar a la carpeta del backend',
      cmd: 'cd backend',
    },
    {
      title: '2. Crear y activar el entorno virtual (venv)',
      cmd: '# Windows (PowerShell):\npython -m venv venv\n.\\venv\\Scripts\\Activate.ps1\n\n# Linux / Mac:\npython3 -m venv venv\nsource venv/bin/activate',
    },
    {
      title: '3. Instalar librerías de requirements.txt',
      cmd: 'pip install -r requirements.txt',
    },
    {
      title: '4. Iniciar el servidor FastAPI (Uvicorn)',
      cmd: 'python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabecera */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-700/50 text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-mono">
                Conexión Backend Python FastAPI &amp; SQLite
              </h3>
              <p className="text-xs text-slate-400">
                Instrucciones para ejecutar y sincronizar el backend en tu PC
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido con scroll */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs text-slate-300">
          {/* Estado Actual de Conexión */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-3.5 h-3.5 rounded-full ${
                  isBackendOnline && !preferLocal
                    ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]'
                    : 'bg-amber-400'
                }`}
              />
              <div>
                <p className="font-mono font-bold text-slate-200 text-sm">
                  {preferLocal
                    ? 'Modo Motor Local Activo (Simulación Autónoma)'
                    : isBackendOnline
                    ? 'FastAPI Conectado y Operativo'
                    : 'FastAPI Desconectado (Usando Motor Local Automático)'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {preferLocal
                    ? 'La app opera directamente en el navegador con persistencia SQLite-mirror'
                    : isBackendOnline
                    ? `Sincronizado con ${parkingApi.getBackendUrl()}`
                    : 'Si no has encendido el backend en tu PC, el simulador local funciona al 100%'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onCheckHealth}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono font-semibold"
              >
                Probar Ping
              </button>
              <button
                onClick={onTogglePreferLocal}
                className={`px-3 py-1.5 rounded-lg border font-mono font-semibold ${
                  preferLocal
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {preferLocal ? 'Forzar Local: ON' : 'Forzar Local: OFF'}
              </button>
            </div>
          </div>

          {/* Configuración de URL */}
          <div className="space-y-1.5">
            <label className="font-mono font-bold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span>URL del Servidor FastAPI:</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={backendUrlInput}
                onChange={(e) => setBackendUrlInput(e.target.value)}
                placeholder="http://localhost:8000"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <button
                onClick={handleSaveUrl}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-all shadow"
              >
                Guardar URL
              </button>
            </div>
          </div>

          {/* Comandos de Terminal Paso a Paso */}
          <div className="space-y-3">
            <h4 className="font-mono font-bold text-slate-200 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-amber-400" />
              <span>Comandos de terminal para arrancar FastAPI en tu PC:</span>
            </h4>

            <div className="space-y-2">
              {commandSteps.map((step, idx) => (
                <div key={idx} className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-slate-300">{step.title}</span>
                    <button
                      onClick={() => copyToClipboard(step.cmd, idx)}
                      className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800"
                    >
                      {copiedIndex === idx ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-2 rounded bg-slate-900/90 text-[11px] font-mono text-cyan-300 overflow-x-auto whitespace-pre-wrap select-all">
                    {step.cmd}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
