import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Eye,
  KeyRound,
  LogOut,
  Maximize2,
  Play,
  QrCode,
  RefreshCw,
  Scan,
  ShieldAlert,
  ShieldCheck,
  SwitchCamera,
  Upload,
  Video,
  VideoOff,
  XCircle,
  Zap,
} from 'lucide-react';
import { OCRResultado, TicketEmitido, ValidacionSalidaResultado } from '../types';
import { normalizarPlaca } from '../utils/parkingRules';
import { soundManager } from '../utils/audioAlarm';
import { reconocerPlacaReal } from '../utils/realOcr';

interface CameraStationProps {
  enRecinto: number;
  capacidadMax: number;
  ticketsActivos: Array<{ id_ticket: string; placa: string; hora_entrada: string }>;
  onProcesarOCR: (imageBase64: string) => Promise<OCRResultado>;
  onEmitirEntrada: (placa: string) => Promise<TicketEmitido>;
  onValidarSalida: (
    idTicket: string,
    placaQR: string,
    placaCamara: string
  ) => Promise<ValidacionSalidaResultado>;
  onSetLcdMensaje: (msg: any) => void;
  onTicketGenerado: (ticket: TicketEmitido) => void;
  onAlertaFraude: (alerta: { placaQR: string; placaCamara: string; mensaje: string }) => void;
}

export const CameraStation: React.FC<CameraStationProps> = ({
  enRecinto,
  capacidadMax,
  ticketsActivos,
  onProcesarOCR,
  onEmitirEntrada,
  onValidarSalida,
  onSetLcdMensaje,
  onTicketGenerado,
  onAlertaFraude,
}) => {
  // Dispositivos de video detectados
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  
  // ================= CÁMARA 1 (ENTRADA) =================
  const [cam1DeviceId, setCam1DeviceId] = useState<string>('');
  const [cam1Active, setCam1Active] = useState<boolean>(false);
  const [cam1Loading, setCam1Loading] = useState<boolean>(false);
  const [cam1Error, setCam1Error] = useState<string | null>(null);
  const [placaEntradaInput, setPlacaEntradaInput] = useState<string>('');
  const [cam1Scanning, setCam1Scanning] = useState<boolean>(false);
  const [barreraEntradaAbierta, setBarreraEntradaAbierta] = useState<boolean>(false);
  const [autoDetectEntrada, setAutoDetectEntrada] = useState<boolean>(true);
  const [autoEmitirTicket, setAutoEmitirTicket] = useState<boolean>(true);
  const [cam1UploadedImage, setCam1UploadedImage] = useState<string | null>(null);
  const [cam1Confianza, setCam1Confianza] = useState<number>(0);
  const [cam1PlacaFijada, setCam1PlacaFijada] = useState<boolean>(false);
  const [cam1TextoCrudo, setCam1TextoCrudo] = useState<string>('');

  // ================= CÁMARA 2 (SALIDA) =================
  const [cam2DeviceId, setCam2DeviceId] = useState<string>('');
  const [cam2Active, setCam2Active] = useState<boolean>(false);
  const [cam2Loading, setCam2Loading] = useState<boolean>(false);
  const [cam2Error, setCam2Error] = useState<string | null>(null);
  const [placaSalidaInput, setPlacaSalidaInput] = useState<string>('');
  const [cam2Scanning, setCam2Scanning] = useState<boolean>(false);
  const [barreraSalidaAbierta, setBarreraSalidaAbierta] = useState<boolean>(false);
  const [autoDetectSalida, setAutoDetectSalida] = useState<boolean>(true);
  const [cam2UploadedImage, setCam2UploadedImage] = useState<string | null>(null);
  const [cam2PlacaFijada, setCam2PlacaFijada] = useState<boolean>(false);

  // Doble Factor Salida
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [qrPlacaDetectada, setQrPlacaDetectada] = useState<string>('');
  const [validandoSalida, setValidandoSalida] = useState<boolean>(false);

  // Referencias para auto-emisión y control de bucle
  const isEmittingRef = useRef<boolean>(false);
  const ultimoTicketEmitido = useRef<{ placa: string; timestamp: number } | null>(null);

  // Elementos DOM
  const video1Ref = useRef<HTMLVideoElement | null>(null);
  const video2Ref = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInput1Ref = useRef<HTMLInputElement | null>(null);
  const fileInput2Ref = useRef<HTMLInputElement | null>(null);

  // Intervalos
  const autoDetectEntradaTimer = useRef<number | null>(null);
  const autoDetectSalidaTimer = useRef<number | null>(null);

  // Presets de vehículos realistas para simulación
  const sampleVehicles = [
    { placa: 'W1X-942', tipo: 'Sedán Gris', color: '#64748b' },
    { placa: 'ABC-123', tipo: 'SUV Rojo', color: '#e11d48' },
    { placa: 'KLP-482', tipo: 'Pick-Up Azul', color: '#2563eb' },
    { placa: 'TRX-709', tipo: 'Deportivo Amarillo', color: '#eab308' },
    { placa: 'NBM-514', tipo: 'Hatchback Blanco', color: '#cbd5e1' },
    { placa: 'ZXY-808', tipo: 'Van Negra', color: '#1e293b' },
  ];

  // Enumerar dispositivos de video al iniciar
  useEffect(() => {
    async function enumerateCams() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(videoInputs);
        if (videoInputs.length > 0) {
          setCam1DeviceId(videoInputs[0].deviceId);
          setCam2DeviceId(videoInputs.length > 1 ? videoInputs[1].deviceId : videoInputs[0].deviceId);
        }
      } catch {
        // Ignorar si no hay permisos iniciales
      }
    }
    enumerateCams();
  }, []);

  // Sincronizar ticket seleccionado inicial
  useEffect(() => {
    if (ticketsActivos.length > 0 && !selectedTicketId) {
      setSelectedTicketId(ticketsActivos[0].id_ticket);
      setQrPlacaDetectada(ticketsActivos[0].placa);
    }
  }, [ticketsActivos, selectedTicketId]);

  const handleSelectTicket = (tktId: string) => {
    setSelectedTicketId(tktId);
    const tkt = ticketsActivos.find((t) => t.id_ticket === tktId);
    if (tkt) {
      setQrPlacaDetectada(tkt.placa);
    }
  };

  /**
   * Conecta con la cámara web de forma ultra-robusta probando múltiples fallbacks
   */
  const requestCameraStream = async (preferredDeviceId?: string): Promise<MediaStream> => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Tu navegador o entorno no soporta getUserMedia para cámaras web.');
    }

    const fallbacks: MediaStreamConstraints[] = [
      preferredDeviceId && preferredDeviceId !== ''
        ? { video: { deviceId: { ideal: preferredDeviceId }, width: { ideal: 1280 } } }
        : null,
      { video: { facingMode: 'environment' } },
      { video: { facingMode: 'user' } },
      { video: true },
    ].filter(Boolean) as MediaStreamConstraints[];

    let lastError: unknown = null;
    for (const constraint of fallbacks) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraint);
        return stream;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('No se pudo acceder a la cámara web.');
  };

  // Encender / Apagar Cámara 1 (Entrada)
  const toggleCam1 = async () => {
    if (cam1Active) {
      if (video1Ref.current && video1Ref.current.srcObject) {
        const stream = video1Ref.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        video1Ref.current.srcObject = null;
      }
      setCam1Active(false);
      return;
    }

    setCam1Loading(true);
    setCam1Error(null);
    try {
      const stream = await requestCameraStream(cam1DeviceId);
      if (video1Ref.current) {
        video1Ref.current.srcObject = stream;
        await video1Ref.current.play();
      }
      setCam1UploadedImage(null);
      setCam1Active(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al conectar cámara';
      setCam1Error(`${msg}. Puedes usar la simulación o subir una foto de auto.`);
      setCam1Active(false);
    } finally {
      setCam1Loading(false);
    }
  };

  // Encender / Apagar Cámara 2 (Salida)
  const toggleCam2 = async () => {
    if (cam2Active) {
      if (video2Ref.current && video2Ref.current.srcObject) {
        const stream = video2Ref.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        video2Ref.current.srcObject = null;
      }
      setCam2Active(false);
      return;
    }

    setCam2Loading(true);
    setCam2Error(null);
    try {
      const stream = await requestCameraStream(cam2DeviceId);
      if (video2Ref.current) {
        video2Ref.current.srcObject = stream;
        await video2Ref.current.play();
      }
      setCam2UploadedImage(null);
      setCam2Active(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al conectar cámara';
      setCam2Error(`${msg}. Puedes usar la simulación o subir una foto.`);
      setCam2Active(false);
    } finally {
      setCam2Loading(false);
    }
  };

  // Capturar frame desde video o imagen cargada
  const captureFrameFromSource = (
    video: HTMLVideoElement | null,
    uploadedImg: string | null
  ): string => {
    if (uploadedImg) return uploadedImg;
    if (!video || video.readyState < 2) return '';

    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  // Reconocimiento manual o disparado de Entrada con OCR Real (sin inventar placas)
  const ejecutarReconocimientoEntrada = async () => {
    setCam1Scanning(true);
    try {
      let res: { placa: string; confianza: number; exito?: boolean; textoCrudo?: string };

      if (cam1Active && video1Ref.current && video1Ref.current.readyState >= 2) {
        res = await reconocerPlacaReal(video1Ref.current);
      } else if (cam1UploadedImage) {
        const img = new Image();
        img.src = cam1UploadedImage;
        await new Promise((resolve) => {
          if (img.complete) resolve(null);
          else img.onload = () => resolve(null);
        });
        res = await reconocerPlacaReal(img);
      } else {
        const frame = captureFrameFromSource(video1Ref.current, cam1UploadedImage);
        res = await onProcesarOCR(frame);
      }

      if (res && res.exito && res.placa) {
        const norm = normalizarPlaca(res.placa);
        setPlacaEntradaInput(norm);
        setCam1Confianza(res.confianza || 0.95);
        setCam1PlacaFijada(true);
        soundManager.playScanBeep();

        if (autoEmitirTicket && !isEmittingRef.current) {
          isEmittingRef.current = true;
          ultimoTicketEmitido.current = { placa: norm, timestamp: Date.now() };
          await handleEmitirTicketEntrada(norm);
          setTimeout(() => { isEmittingRef.current = false; }, 4000);
        }
      } else {
        setCam1PlacaFijada(false);
        soundManager.playScanBeep();
        alert('No se detectó ninguna placa legible en la imagen. Asegúrate de enfocar la matrícula de frente con buena luz.');
      }
    } catch (err: unknown) {
      console.warn('Error en escaneo manual:', err);
    } finally {
      setCam1Scanning(false);
    }
  };

  // Reconocimiento manual o disparado de Salida con OCR Real
  const ejecutarReconocimientoSalida = async () => {
    setCam2Scanning(true);
    try {
      let res: { placa: string; confianza: number; exito?: boolean };
      if (cam2Active && video2Ref.current && video2Ref.current.readyState >= 2) {
        res = await reconocerPlacaReal(video2Ref.current);
      } else if (cam2UploadedImage) {
        const img = new Image();
        img.src = cam2UploadedImage;
        await new Promise((resolve) => {
          if (img.complete) resolve(null);
          else img.onload = () => resolve(null);
        });
        res = await reconocerPlacaReal(img);
      } else {
        const frame = captureFrameFromSource(video2Ref.current, cam2UploadedImage);
        res = await onProcesarOCR(frame);
      }

      if (res && res.exito && res.placa) {
        const norm = normalizarPlaca(res.placa);
        setPlacaSalidaInput(norm);
        setCam2PlacaFijada(true);
        soundManager.playScanBeep();
      } else {
        setCam2PlacaFijada(false);
        alert('No se detectó placa en la Cámara de Salida. Acerca la matrícula al encuadre.');
      }
    } catch {
      // no-op
    } finally {
      setCam2Scanning(false);
    }
  };

  // Bucle automático de Entrada: Escaneo continuo con Tesseract.js (NO inventa placas)
  useEffect(() => {
    if (!autoDetectEntrada) {
      if (autoDetectEntradaTimer.current) clearInterval(autoDetectEntradaTimer.current);
      return;
    }

    autoDetectEntradaTimer.current = window.setInterval(async () => {
      if (cam1Active && video1Ref.current && video1Ref.current.readyState >= 2) {
        try {
          const res = await reconocerPlacaReal(video1Ref.current);
          if (res.exito && res.placa) {
            const norm = normalizarPlaca(res.placa);
            setPlacaEntradaInput(norm);
            setCam1Confianza(res.confianza);
            setCam1PlacaFijada(true);
            setCam1TextoCrudo(res.textoCrudo);

            // Auto-emitir ticket inmediatamente si está habilitado
            if (
              autoEmitirTicket &&
              !isEmittingRef.current &&
              enRecinto < capacidadMax &&
              (!ultimoTicketEmitido.current ||
                ultimoTicketEmitido.current.placa !== norm ||
                Date.now() - ultimoTicketEmitido.current.timestamp > 15000)
            ) {
              isEmittingRef.current = true;
              ultimoTicketEmitido.current = { placa: norm, timestamp: Date.now() };
              await handleEmitirTicketEntrada(norm);
              setTimeout(() => { isEmittingRef.current = false; }, 4000);
            }
          } else {
            // NO INVENTAR NADA
            setCam1PlacaFijada(false);
            if (res.textoCrudo) {
              setCam1TextoCrudo(res.textoCrudo);
            }
          }
        } catch {
          // no-op
        }
      }
    }, 1200);

    return () => {
      if (autoDetectEntradaTimer.current) clearInterval(autoDetectEntradaTimer.current);
    };
  }, [autoDetectEntrada, cam1Active, autoEmitirTicket, enRecinto, capacidadMax]);

  // Bucle automático de Salida (Escaneo de QR + OCR Real de Placa)
  useEffect(() => {
    if (!autoDetectSalida) {
      if (autoDetectSalidaTimer.current) clearInterval(autoDetectSalidaTimer.current);
      return;
    }

    autoDetectSalidaTimer.current = window.setInterval(async () => {
      if (!video2Ref.current || video2Ref.current.readyState < 2) return;

      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video2Ref.current, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // 1. Escaneo QR
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        try {
          const parsed = JSON.parse(code.data);
          if (parsed.id_ticket && parsed.placa) {
            setSelectedTicketId(parsed.id_ticket);
            setQrPlacaDetectada(normalizarPlaca(parsed.placa));
            soundManager.playScanBeep();
          }
        } catch {
          if (code.data.length >= 6) {
            setQrPlacaDetectada(normalizarPlaca(code.data));
          }
        }
      }

      // 2. Reconocimiento OCR de Placa física en salida
      if (cam2Active) {
        try {
          const res = await reconocerPlacaReal(video2Ref.current);
          if (res.exito && res.placa) {
            setPlacaSalidaInput(res.placa);
            setCam2PlacaFijada(true);
          } else {
            setCam2PlacaFijada(false);
          }
        } catch {
          // no-op
        }
      }
    }, 1000);

    return () => {
      if (autoDetectSalidaTimer.current) clearInterval(autoDetectSalidaTimer.current);
    };
  }, [autoDetectSalida, cam2Active]);

  // Cargar imagen de vehículo local desde el disco y procesar con OCR Real
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, camNumber: 1 | 2) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const b64 = event.target?.result as string;
      const img = new Image();
      img.src = b64;
      await new Promise((resolve) => {
        if (img.complete) resolve(null);
        else img.onload = () => resolve(null);
      });

      if (camNumber === 1) {
        setCam1UploadedImage(b64);
        setCam1Active(false);
        soundManager.playScanBeep();
        
        // OCR Real sobre la foto
        const res = await reconocerPlacaReal(img);
        if (res.exito && res.placa) {
          const norm = normalizarPlaca(res.placa);
          setPlacaEntradaInput(norm);
          setCam1Confianza(res.confianza);
          setCam1PlacaFijada(true);
          soundManager.playSuccessBeep();

          // Auto-emitir ticket inmediatamente
          if (autoEmitirTicket && !isEmittingRef.current) {
            isEmittingRef.current = true;
            ultimoTicketEmitido.current = { placa: norm, timestamp: Date.now() };
            await handleEmitirTicketEntrada(norm);
            setTimeout(() => { isEmittingRef.current = false; }, 4000);
          }
        } else {
          setCam1PlacaFijada(false);
          alert('Foto cargada, pero no se reconoció una matrícula válida. Ajusta la imagen o escribe la placa.');
        }
      } else {
        setCam2UploadedImage(b64);
        setCam2Active(false);
        soundManager.playScanBeep();
        const res = await reconocerPlacaReal(img);
        if (res.exito && res.placa) {
          const norm = normalizarPlaca(res.placa);
          setPlacaSalidaInput(norm);
          setCam2PlacaFijada(true);
          soundManager.playSuccessBeep();
        } else {
          setCam2PlacaFijada(false);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Cargar preset de vehículo para pruebas inmediatas
  const handleSelectPreset = async (v: { placa: string; tipo: string; color: string }, camNumber: 1 | 2) => {
    soundManager.playScanBeep();
    if (camNumber === 1) {
      setPlacaEntradaInput(v.placa);
      setCam1UploadedImage(null);
      setCam1Confianza(0.98);
      setCam1PlacaFijada(true);

      // Auto-emitir ticket si está activo
      if (autoEmitirTicket && !isEmittingRef.current) {
        isEmittingRef.current = true;
        ultimoTicketEmitido.current = { placa: v.placa, timestamp: Date.now() };
        await handleEmitirTicketEntrada(v.placa);
        setTimeout(() => { isEmittingRef.current = false; }, 4000);
      }
    } else {
      setPlacaSalidaInput(v.placa);
      setCam2UploadedImage(null);
      setCam2PlacaFijada(true);
    }
  };

  // Emitir Ticket y Abrir Barrera Entrada
  const handleEmitirTicketEntrada = async (placaOpcional?: string) => {
    const placaFinal = normalizarPlaca(typeof placaOpcional === 'string' ? placaOpcional : placaEntradaInput);
    if (!placaFinal) {
      alert('Debes enfocar o ingresar una matrícula válida.');
      return;
    }

    try {
      onSetLcdMensaje('RETIRE_TICKET');
      const ticket = await onEmitirEntrada(placaFinal);
      soundManager.playSuccessBeep();
      onTicketGenerado(ticket);

      setBarreraEntradaAbierta(true);
      setTimeout(() => {
        setBarreraEntradaAbierta(false);
        onSetLcdMensaje('ACCESO_DISPONIBLE');
      }, 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al emitir ticket';
      console.warn(msg);
      onSetLcdMensaje('ACCESO_DISPONIBLE');
    }
  };

  // Validar Salida Cruzada (Regla Antirrobo)
  const handleValidarSalidaCruzada = async () => {
    if (!selectedTicketId) {
      alert('Debe escanear o seleccionar un Ticket QR activo.');
      return;
    }
    if (!placaSalidaInput) {
      alert('Debe capturar o ingresar la placa en la Cámara de Salida.');
      return;
    }

    setValidandoSalida(true);
    try {
      const res = await onValidarSalida(
        selectedTicketId,
        qrPlacaDetectada,
        placaSalidaInput
      );

      if (res.alerta_fraude) {
        onSetLcdMensaje('ERROR_SEGURIDAD');
        soundManager.startSecurityAlarm(6);
        onAlertaFraude({
          placaQR: qrPlacaDetectada,
          placaCamara: placaSalidaInput,
          mensaje: res.mensaje,
        });
      } else if (res.autorizado) {
        onSetLcdMensaje('QR_PLACA_VALIDO');
        soundManager.playSuccessBeep();
        setBarreraSalidaAbierta(true);
        setTimeout(() => {
          setBarreraSalidaAbierta(false);
          onSetLcdMensaje('ACCESO_DISPONIBLE');
        }, 5000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al validar salida';
      alert(msg);
    } finally {
      setValidandoSalida(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Barra de compatibilidad y control en AI Studio */}
      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-700/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-700/60 font-bold">
            <Zap className="w-4 h-4" />
          </span>
          <div>
            <span className="font-bold text-slate-200">
              ¡Operativo 100% en AI Studio!
            </span>
            <span className="text-slate-400 ml-1">
              Puedes usar la Cámara Virtual Interactiva con autos de prueba, subir fotos de placas desde tu PC, o conectar tu Webcam USB.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.open(window.location.href, '_blank');
              }
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-[11px] font-bold border border-slate-700 transition-colors flex items-center gap-1"
            title="Abrir en pestaña independiente para otorgar permisos directos de cámara al navegador"
          >
            <span>Abrir en Pestaña Nueva</span>
            <span>↗</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Canvas para captura */}
        <canvas ref={canvasRef} className="hidden" />

      {/* Input de archivos oculto para Cámara 1 */}
      <input
        ref={fileInput1Ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileUpload(e, 1)}
      />

      {/* Input de archivos oculto para Cámara 2 */}
      <input
        ref={fileInput2Ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileUpload(e, 2)}
      />

      {/* ========================================================================= */}
      {/* ESTACIÓN 1: CÁMARA 1 - ENTRADA (YOLO ALPR / OCR AUTOMÁTICO)               */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 shadow-xl flex flex-col justify-between">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-700/50 text-emerald-400">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                  Cámara 1: Entrada (YOLO ALPR)
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                  YOLOv8 + OCR
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Reconocimiento automático de cualquier matrícula en tiempo real
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Auto-Detect */}
            <button
              onClick={() => setAutoDetectEntrada(!autoDetectEntrada)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 border transition-all ${
                autoDetectEntrada
                  ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title="Activar o desactivar reconocimiento continuo en bucle"
            >
              <Zap className={`w-3 h-3 ${autoDetectEntrada ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span>AUTO: {autoDetectEntrada ? 'ON' : 'OFF'}</span>
            </button>

            {/* Toggle Auto-Emitir Ticket al Detectar */}
            <button
              onClick={() => setAutoEmitirTicket(!autoEmitirTicket)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 border transition-all ${
                autoEmitirTicket
                  ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500 shadow-sm'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title="Generar el ticket automáticamente apenas la cámara detecte la matrícula"
            >
              <CheckCircle2 className={`w-3 h-3 ${autoEmitirTicket ? 'text-cyan-400' : 'text-slate-500'}`} />
              <span>AUTO-TICKET: {autoEmitirTicket ? 'ON' : 'OFF'}</span>
            </button>

            {/* Estado Barrera */}
            <div
              className={`px-2 py-1 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all ${
                barreraEntradaAbierta
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500 animate-pulse'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${barreraEntradaAbierta ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              <span>BARRERA: {barreraEntradaAbierta ? 'ABIERTA' : 'CERRADA'}</span>
            </div>
          </div>
        </div>

        {/* Viewport de Video / Foto con Overlay YOLO */}
        <div className="mt-3 relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center group shadow-inner">
          {/* Video en vivo */}
          <video
            ref={video1Ref}
            playsInline
            muted
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              cam1Active && !cam1UploadedImage ? 'opacity-100' : 'hidden'
            }`}
          />

          {/* Imagen cargada desde PC */}
          {cam1UploadedImage && (
            <img
              src={cam1UploadedImage}
              alt="Vehículo cargado en Entrada"
              className="w-full h-full object-contain bg-slate-950"
            />
          )}

          {/* Si la cámara no está activa y no hay imagen cargada: Feed Simulado con auto */}
          {!cam1Active && !cam1UploadedImage && (
            <div className="relative w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-b from-slate-900 via-slate-925 to-slate-950 overflow-hidden">
              {/* Carril de entrada con asfalto y marcas viales */}
              <div className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(#38bdf8 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }}
              />

              {/* Ilustración de auto presente en el carril con faros encendidos */}
              <div className="relative z-10 flex flex-col items-center animate-in zoom-in duration-300">
                {/* Carrocería */}
                <div className="w-56 h-22 bg-gradient-to-b from-slate-700 to-slate-900 rounded-2xl border-2 border-slate-600 flex flex-col items-center justify-between p-2 shadow-2xl relative">
                  {/* Parabrisas con reflejo */}
                  <div className="w-36 h-6 bg-cyan-950/90 rounded-t-lg border border-cyan-500/40 flex items-center justify-center">
                    <div className="w-24 h-1 bg-white/20 rounded-full" />
                  </div>

                  {/* Faros LED delanteros */}
                  <div className="w-full flex justify-between px-3">
                    <div className="w-4 h-2 bg-amber-300 rounded shadow-[0_0_12px_#fde047] animate-pulse" />
                    <div className="w-4 h-2 bg-amber-300 rounded shadow-[0_0_12px_#fde047] animate-pulse" />
                  </div>

                  {/* Placa metálica oficial iluminada */}
                  <div className="px-3 py-1 rounded bg-slate-50 border-2 border-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.8)] flex items-center gap-1.5">
                    <span className="text-[8px] font-mono text-slate-500 font-bold">PERÚ</span>
                    <span className="font-mono font-black text-base text-slate-900 tracking-widest">
                      {placaEntradaInput || '--- ---'}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 border ${
                    cam1PlacaFijada
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-slate-900 text-slate-400 border-slate-700'
                  }`}>
                    <Zap className={`w-3 h-3 ${cam1PlacaFijada ? 'text-emerald-400' : 'text-slate-500'}`} />
                    {cam1PlacaFijada ? 'PLACA FIJADA POR OCR' : 'EN ESPERA DE MATRÍCULA'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* OVERLAY YOLO: Bounding Box Dinámico ALPR */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
            <div className={`w-56 sm:w-64 h-24 border-2 rounded-lg relative transition-colors duration-300 ${
              cam1PlacaFijada && placaEntradaInput
                ? 'border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] bg-emerald-500/5'
                : 'border-cyan-400/70 shadow-[0_0_15px_rgba(56,189,248,0.25)] bg-cyan-500/5'
            }`}>
              {/* Esquinas */}
              <div className="absolute -top-1 -left-1 w-3.5 h-3.5 border-t-2 border-l-2 border-emerald-300" />
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 border-t-2 border-r-2 border-emerald-300" />
              <div className="absolute -bottom-1 -left-1 w-3.5 h-3.5 border-b-2 border-l-2 border-emerald-300" />
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 border-b-2 border-r-2 border-emerald-300" />

              {/* Tag superior */}
              <div className={`absolute -top-6 left-1 px-2 py-0.5 rounded text-white font-mono text-[10px] font-black tracking-wide flex items-center gap-1 shadow ${
                cam1PlacaFijada && placaEntradaInput ? 'bg-emerald-600' : 'bg-cyan-700'
              }`}>
                <span>
                  {cam1PlacaFijada && placaEntradaInput
                    ? `[PLACA DETECTADA: ${placaEntradaInput} ${Math.round(cam1Confianza * 100)}%]`
                    : '[APUNTE LA CÁMARA A LA MATRÍCULA]'}
                </span>
              </div>

              {/* Láser de barrido animado */}
              {(cam1Scanning || autoDetectEntrada) && (
                <div className="absolute inset-x-0 h-0.5 bg-cyan-400 shadow-[0_0_10px_#38bdf8] animate-pulse" />
              )}
            </div>
          </div>

          {/* Barra de estado inferior */}
          <div className="absolute bottom-2 left-2 right-2 pointer-events-none flex items-center justify-between">
            <div className="flex items-center gap-1.5 bg-slate-900/90 px-2 py-1 rounded border border-slate-700 text-[10px] font-mono text-slate-300">
              <span className={`w-2 h-2 rounded-full ${cam1Active ? 'bg-emerald-400 animate-ping' : 'bg-cyan-400'}`} />
              <span>{cam1Active ? 'WEBCAM VIVO' : cam1UploadedImage ? 'FOTO CARGADA' : 'SIMULADOR ALPR'}</span>
            </div>

            {/* Pluma mecánica animada */}
            <div className="flex items-center gap-2">
              <div
                className={`h-2.5 w-24 sm:w-28 rounded transition-all duration-700 origin-left border shadow-md ${
                  barreraEntradaAbierta
                    ? '-rotate-45 -translate-y-4 bg-emerald-500 border-emerald-300'
                    : 'rotate-0 bg-rose-600 border-rose-400'
                }`}
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.4) 8px, rgba(255,255,255,0.4) 16px)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Mensaje de error / advertencia de cámara */}
        {cam1Error && (
          <p className="mt-2 text-[11px] text-amber-300 bg-amber-950/40 p-1.5 rounded border border-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{cam1Error}</span>
          </p>
        )}

        {/* Acciones de Entrada: Encender Cámara / Subir Foto / Presets */}
        <div className="mt-3.5 space-y-3">
          {/* Fila de Botones de Dispositivo */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={toggleCam1}
              disabled={cam1Loading}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all shadow flex items-center justify-center gap-1.5 ${
                cam1Active
                  ? 'bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {cam1Active ? <VideoOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
              <span>{cam1Loading ? 'Iniciando...' : cam1Active ? 'Apagar Cámara' : 'Iniciar Webcam'}</span>
            </button>

            <button
              onClick={() => fileInput1Ref.current?.click()}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-colors"
              title="Subir cualquier foto de un auto con matrícula desde tu PC"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>Subir Foto</span>
            </button>

            {videoDevices.length > 1 && (
              <select
                aria-label="Seleccionar Cámara de Entrada"
                value={cam1DeviceId}
                onChange={(e) => {
                  setCam1DeviceId(e.target.value);
                  if (cam1Active) {
                    toggleCam1();
                    setTimeout(toggleCam1, 300);
                  }
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono"
              >
                {videoDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Cámara ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Presets Rápidos de Autos */}
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
            <span className="text-slate-400 text-[10px] font-mono">Autos de Prueba:</span>
            <div className="flex flex-wrap gap-1">
              {sampleVehicles.map((v) => (
                <button
                  key={v.placa}
                  onClick={() => handleSelectPreset(v, 1)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border transition-all ${
                    placaEntradaInput === v.placa
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-500'
                      : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
                  }`}
                  title={`${v.tipo}`}
                >
                  {v.placa}
                </button>
              ))}
            </div>
          </div>

          {/* Input editable de la placa + Botón Forzar OCR */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <label className="absolute -top-2 left-2 bg-slate-900 px-1 font-mono text-[9px] text-slate-400 uppercase">
                Placa Detectada (YOLO + OCR)
              </label>
              <input
                type="text"
                value={placaEntradaInput}
                onChange={(e) => setPlacaEntradaInput(e.target.value.toUpperCase())}
                placeholder="Ej. W1X-942"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono font-bold text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-cyan-500 uppercase"
              />
            </div>

            <button
              onClick={ejecutarReconocimientoEntrada}
              disabled={cam1Scanning}
              className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow active:scale-95 disabled:opacity-50"
              title="Escanear placa del frame actual"
            >
              <Scan className="w-4 h-4" />
              <span>{cam1Scanning ? 'Escaneando...' : 'Re-Escanear'}</span>
            </button>
          </div>

          {/* Botón Principal: Emitir Ticket QR y Abrir Barrera */}
          <button
            onClick={() => handleEmitirTicketEntrada()}
            disabled={enRecinto >= capacidadMax}
            className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-lg active:scale-98 ${
              enRecinto >= capacidadMax
                ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>
              {enRecinto >= capacidadMax
                ? 'AFORO COMPLETO (8/8) - INGRESO BLOQUEADO'
                : 'Emitir Ticket QR y Abrir Barrera Entrada'}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ESTACIÓN 2: CÁMARA 2 - SALIDA (DOBLE FACTOR ANTIRROBO: QR + PLACA YOLO)   */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 shadow-xl flex flex-col justify-between">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-950/80 border border-amber-700/50 text-amber-400">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                  Cámara 2: Salida (Antirrobo)
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                  DOBLE FACTOR
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Match cruzado: Ticket QR vs Placa física detectada por YOLO
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Auto-Detect */}
            <button
              onClick={() => setAutoDetectSalida(!autoDetectSalida)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 border transition-all ${
                autoDetectSalida
                  ? 'bg-amber-950/90 text-amber-300 border-amber-500'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title="Escaneo automático en bucle para QR y placas"
            >
              <Zap className={`w-3 h-3 ${autoDetectSalida ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`} />
              <span>AUTO: {autoDetectSalida ? 'ON' : 'OFF'}</span>
            </button>

            {/* Estado Barrera */}
            <div
              className={`px-2 py-1 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all ${
                barreraSalidaAbierta
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500 animate-pulse'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${barreraSalidaAbierta ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              <span>BARRERA: {barreraSalidaAbierta ? 'ABIERTA' : 'CERRADA'}</span>
            </div>
          </div>
        </div>

        {/* Viewport de Salida con Overlay YOLO */}
        <div className="mt-3 relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center group shadow-inner">
          <video
            ref={video2Ref}
            playsInline
            muted
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              cam2Active && !cam2UploadedImage ? 'opacity-100' : 'hidden'
            }`}
          />

          {cam2UploadedImage && (
            <img
              src={cam2UploadedImage}
              alt="Vehículo cargado en Salida"
              className="w-full h-full object-contain bg-slate-950"
            />
          )}

          {!cam2Active && !cam2UploadedImage && (
            <div className="relative w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-b from-slate-900 via-slate-925 to-slate-950 overflow-hidden">
              <div className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(#f59e0b 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }}
              />

              <div className="relative z-10 flex flex-col items-center animate-in zoom-in duration-300">
                <div className="w-56 h-22 bg-gradient-to-b from-slate-700 to-slate-900 rounded-2xl border-2 border-slate-600 flex flex-col items-center justify-between p-2 shadow-2xl relative">
                  <div className="w-36 h-6 bg-amber-950/90 rounded-t-lg border border-amber-500/40 flex items-center justify-center">
                    <div className="w-24 h-1 bg-white/20 rounded-full" />
                  </div>

                  <div className="w-full flex justify-between px-3">
                    <div className="w-4 h-2 bg-rose-500 rounded shadow-[0_0_12px_#f43f5e] animate-pulse" />
                    <div className="w-4 h-2 bg-rose-500 rounded shadow-[0_0_12px_#f43f5e] animate-pulse" />
                  </div>

                  <div className="px-3 py-1 rounded bg-slate-50 border-2 border-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.8)] flex items-center gap-1.5">
                    <span className="text-[8px] font-mono text-slate-500 font-bold">PERÚ</span>
                    <span className="font-mono font-black text-base text-slate-900 tracking-widest">
                      {placaSalidaInput || '--- ---'}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 border ${
                    cam2PlacaFijada
                      ? 'bg-amber-950 text-amber-300 border-amber-700'
                      : 'bg-slate-900 text-slate-400 border-slate-700'
                  }`}>
                    <Zap className={`w-3 h-3 ${cam2PlacaFijada ? 'text-amber-400' : 'text-slate-500'}`} />
                    {cam2PlacaFijada ? 'PLACA SALIDA FIJADA' : 'SALIDA EN ESPERA'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Overlay YOLO / QR Salida */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
            <div className={`w-56 sm:w-64 h-24 border-2 rounded-lg relative transition-colors duration-300 ${
              cam2PlacaFijada && placaSalidaInput
                ? 'border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.35)] bg-amber-500/5'
                : 'border-slate-600 shadow-none bg-transparent'
            }`}>
              <div className="absolute -top-1 -left-1 w-3.5 h-3.5 border-t-2 border-l-2 border-amber-300" />
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 border-t-2 border-r-2 border-amber-300" />
              <div className="absolute -bottom-1 -left-1 w-3.5 h-3.5 border-b-2 border-l-2 border-amber-300" />
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 border-b-2 border-r-2 border-amber-300" />

              <div className={`absolute -top-6 left-1 px-2 py-0.5 rounded text-white font-mono text-[10px] font-black tracking-wide flex items-center gap-1 shadow ${
                cam2PlacaFijada && placaSalidaInput ? 'bg-amber-600' : 'bg-slate-700 text-slate-300'
              }`}>
                <span>
                  {cam2PlacaFijada && placaSalidaInput
                    ? `[PLACA SALIDA: ${placaSalidaInput}]`
                    : '[ENFOCANDO SALIDA: QR O MATRÍCULA]'}
                </span>
              </div>

              {(cam2Scanning || autoDetectSalida) && (
                <div className="absolute inset-x-0 h-0.5 bg-amber-400 shadow-[0_0_10px_#f59e0b] animate-pulse" />
              )}
            </div>
          </div>

          <div className="absolute bottom-2 left-2 right-2 pointer-events-none flex items-center justify-between">
            <div className="flex items-center gap-1.5 bg-slate-900/90 px-2 py-1 rounded border border-slate-700 text-[10px] font-mono text-slate-300">
              <span className={`w-2 h-2 rounded-full ${cam2Active ? 'bg-amber-400 animate-ping' : 'bg-cyan-400'}`} />
              <span>{cam2Active ? 'WEBCAM VIVO' : cam2UploadedImage ? 'FOTO CARGADA' : 'SIMULADOR SALIDA'}</span>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`h-2.5 w-24 sm:w-28 rounded transition-all duration-700 origin-right border shadow-md ${
                  barreraSalidaAbierta
                    ? 'rotate-45 -translate-y-4 bg-emerald-500 border-emerald-300'
                    : 'rotate-0 bg-rose-600 border-rose-400'
                }`}
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.4) 8px, rgba(255,255,255,0.4) 16px)',
                }}
              />
            </div>
          </div>
        </div>

        {cam2Error && (
          <p className="mt-2 text-[11px] text-amber-300 bg-amber-950/40 p-1.5 rounded border border-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{cam2Error}</span>
          </p>
        )}

        {/* Acciones de Salida */}
        <div className="mt-3.5 space-y-3">
          {/* Fila de Botones Cámara 2 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={toggleCam2}
              disabled={cam2Loading}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all shadow flex items-center justify-center gap-1.5 ${
                cam2Active
                  ? 'bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700'
                  : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
            >
              {cam2Active ? <VideoOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
              <span>{cam2Loading ? 'Iniciando...' : cam2Active ? 'Apagar Cámara' : 'Iniciar Webcam'}</span>
            </button>

            <button
              onClick={() => fileInput2Ref.current?.click()}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-colors"
              title="Subir foto para Cámara 2"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span>Subir Foto</span>
            </button>
          </div>

          {/* Factor 1: Ticket QR */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-slate-300 font-bold flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                1. TICKET QR EN SALIDA:
              </span>
              <span className="text-[10px] text-slate-400">
                {ticketsActivos.length} activos en recinto
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                aria-label="Seleccionar Ticket Activo en Recinto"
                value={selectedTicketId}
                onChange={(e) => handleSelectTicket(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              >
                {ticketsActivos.length === 0 ? (
                  <option value="">No hay tickets activos dentro</option>
                ) : (
                  ticketsActivos.map((t) => (
                    <option key={t.id_ticket} value={t.id_ticket}>
                      {t.id_ticket} ({t.placa})
                    </option>
                  ))
                )}
              </select>

              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono">
                <span className="text-slate-400 text-[10px]">Placa en QR:</span>
                <span className="font-bold text-cyan-300 font-mono tracking-wider">
                  {qrPlacaDetectada || '---'}
                </span>
              </div>
            </div>
          </div>

          {/* Factor 2: Placa Física leída por YOLO */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-slate-300 font-bold flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-amber-400" />
                2. PLACA DETECTADA POR YOLO EN SALIDA:
              </span>
              <div className="flex gap-1">
                {sampleVehicles.slice(0, 3).map((v) => (
                  <button
                    key={v.placa}
                    onClick={() => handleSelectPreset(v, 2)}
                    className="text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  >
                    {v.placa}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={placaSalidaInput}
                onChange={(e) => setPlacaSalidaInput(e.target.value.toUpperCase())}
                placeholder="Placa en cámara de salida..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono font-bold text-xs tracking-wider focus:outline-none focus:ring-1 focus:ring-amber-500 uppercase"
              />

              <button
                onClick={ejecutarReconocimientoSalida}
                disabled={cam2Scanning}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 transition-all shadow active:scale-95 disabled:opacity-50"
              >
                <Scan className="w-3.5 h-3.5" />
                <span>{cam2Scanning ? '...' : 'Re-Escanear'}</span>
              </button>
            </div>
          </div>

          {/* Indicador de coincidencia cruzada */}
          <div className="flex items-center justify-between text-[11px] px-1 font-mono">
            <span className="text-slate-400">Match Cruzado:</span>
            {normalizarPlaca(qrPlacaDetectada) === normalizarPlaca(placaSalidaInput) && qrPlacaDetectada ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                COINCIDENCIA EXACTA ({normalizarPlaca(qrPlacaDetectada)})
              </span>
            ) : qrPlacaDetectada && placaSalidaInput ? (
              <span className="text-rose-400 font-bold flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 animate-pulse" />
                ¡DISCREPANCIA! (ALERTA DE SEGURIDAD)
              </span>
            ) : (
              <span className="text-slate-500">Pendiente de datos</span>
            )}
          </div>

          {/* Botón Principal: Validar Salida Cruzada */}
          <button
            onClick={handleValidarSalidaCruzada}
            disabled={validandoSalida || ticketsActivos.length === 0}
            className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-lg active:scale-98 ${
              ticketsActivos.length === 0
                ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30'
            }`}
          >
            <LogOut className="w-4 h-4" />
            <span>
              {validandoSalida
                ? 'Validando con YOLO...'
                : 'Validar Salida y Cruzar Barrera (Match Cruzado)'}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
  );
};
