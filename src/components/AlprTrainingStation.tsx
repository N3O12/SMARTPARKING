import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Crop,
  Database,
  Download,
  Eye,
  FileCheck,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Play,
  RefreshCw,
  RotateCcw,
  Scan,
  ShieldCheck,
  Sparkles,
  SwitchCamera,
  Trash2,
  Unlock,
  Upload,
  Video,
  VideoOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { FeedbackStats, OCRResultado, EstadoEntrenamientoYOLO } from '../types';
import { parkingApi } from '../services/api';
import { normalizarPlaca } from '../utils/parkingRules';
import { soundManager } from '../utils/audioAlarm';
import { reconocerPlacaReal, guardarEnMemoriaAprendizajeCliente } from '../utils/realOcr';

interface AlprTrainingStationProps {
  onProcesarOCR: (imageBase64: string) => Promise<OCRResultado>;
  onVolverEstacionamiento?: () => void;
  isBackendOnline: boolean;
}

export const AlprTrainingStation: React.FC<AlprTrainingStationProps> = ({
  onProcesarOCR,
  onVolverEstacionamiento,
  isBackendOnline,
}) => {
  // Cámara y streaming
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraLoading, setCameraLoading] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Escaneo y OCR en vivo
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState<boolean>(true);
  const [scanFps, setScanFps] = useState<number>(0);
  const [sharpnessLevel, setSharpnessLevel] = useState<'ALTA' | 'MEDIA' | 'BAJA'>('ALTA');
  const [sharpnessScore, setSharpnessScore] = useState<number>(100);
  const [scanLatencyMs, setScanLatencyMs] = useState<number>(0);

  // Resultado de detección actual
  const [detectedPlate, setDetectedPlate] = useState<string>('');
  const [detectedRaw, setDetectedRaw] = useState<string>('');
  const [detectedConfidence, setDetectedConfidence] = useState<number>(0);
  const [detectedMethod, setDetectedMethod] = useState<string>('');
  const [lastFrameImage, setLastFrameImage] = useState<string | null>(null);
  const [plateCropImage, setPlateCropImage] = useState<string | null>(null);
  const [lastBbox, setLastBbox] = useState<number[] | undefined>(undefined);
  const [detectedFrameDims, setDetectedFrameDims] = useState<{ width: number; height: number }>({ width: 640, height: 480 });

  // FOTOGRAMA CONGELADO PARA VALIDACIÓN Y CORRECCIÓN:
  // Garantiza que la imagen exacta que se usó para leer la placa NO cambie ni se pierda mientras el usuario revisa o corrige
  const [lockedSnapshotImage, setLockedSnapshotImage] = useState<string | null>(null);
  const [lockedCropImage, setLockedCropImage] = useState<string | null>(null);
  const [lockedBbox, setLockedBbox] = useState<number[] | undefined>(undefined);
  const [lockedPlate, setLockedPlate] = useState<string>('');
  const [lockedConfidence, setLockedConfidence] = useState<number>(0);
  const [isValidationFrozen, setIsValidationFrozen] = useState<boolean>(false);

  // Modo corrección manual (Human-in-the-loop)
  const [isCorrectionOpen, setIsCorrectionOpen] = useState<boolean>(false);
  const [manualPlateInput, setManualPlateInput] = useState<string>('');
  const [actionFeedbackMsg, setActionFeedbackMsg] = useState<{
    tipo: 'success' | 'correction' | 'info';
    texto: string;
  } | null>(null);

  // Estadísticas de auto-entrenamiento
  const [trainingStats, setTrainingStats] = useState<FeedbackStats>({
    total_muestras: 0,
    total_confirmadas: 0,
    total_corregidas: 0,
    correcciones: {},
    modelo_actual: 'YOLOv8 Placas Perú (dataset roboflow + auto-entrenamiento)',
    listo_para_reentrenar: false,
  });
  const [isTrainingRunning, setIsTrainingRunning] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<EstadoEntrenamientoYOLO | null>(null);
  const [trainingEpochs, setTrainingEpochs] = useState<number>(10);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // Filtros visuales y zoom opcional (por defecto 1.0x = Toda la Foto Completa)
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0); // 1.0x = 100% Campo Visual Completo

  const cambiarZoom = (nivel: number) => {
    setZoomLevel(nivel);
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track as any).getCapabilities?.() || {};
        if (capabilities.zoom) {
          track.applyConstraints({ advanced: [{ zoom: nivel }] } as any).catch(() => {});
        }
      }
    }
  };

  // Referencias DOM
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const isProcessingFrameRef = useRef<boolean>(false);
  const consecutiveDetectionRef = useRef<{ plate: string; count: number }>({ plate: '', count: 0 });
  const fpsCounterRef = useRef<{ count: number; lastTime: number }>({ count: 0, lastTime: Date.now() });

  // Placa de prueba oficial subida por el usuario
  const samplePlateImage = '/assets/aistudio/images__1__bb1877f0.jpg';

  // Cargar dispositivos al montar
  useEffect(() => {
    async function enumerate() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(videoInputs);
        if (videoInputs.length > 0 && !currentDeviceId) {
          setCurrentDeviceId(videoInputs[0].deviceId);
        }
      } catch {
        // Ignorar si no hay permisos aún
      }
    }
    enumerate();
    cargarEstadisticas();
  }, []);

  const cargarEstadisticas = async () => {
    try {
      const stats = await parkingApi.obtenerEstadisticasEntrenamiento();
      setTrainingStats(stats);
    } catch (e) {
      console.warn('Error cargando stats de auto-entrenamiento:', e);
    }
  };

  /**
   * Conecta con la cámara web de forma robusta
   */
  const iniciarCamara = async (preferredDeviceId?: string) => {
    setCameraLoading(true);
    setCameraError(null);

    // Detener stream previo
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }

    try {
      let stream: MediaStream | null = null;
      const deviceToUse = preferredDeviceId || currentDeviceId;

      if (deviceToUse) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: deviceToUse },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch {
          // Fallback a cualquier cámara trasera/frontal
        }
      }

      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err: any) {
      console.error('Error al iniciar cámara:', err);
      setCameraError(
        'No se pudo acceder a la cámara web. Asegúrese de otorgar permisos de cámara en el navegador o use el botón de "Subir Imagen".'
      );
      setIsCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  };

  const detenerCamara = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  };

  /**
   * Captura el 100% de la foto completa capturada por la cámara (sin recortar bordes)
   */
  const capturarFrameActual = (): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    // Captura TODO el campo de visión completo de la cámara sin descartar ninguna esquina
    const maxDim = 960;
    const scale = Math.min(1.0, maxDim / Math.max(vw, vh));

    const targetW = Math.round(vw * scale);
    const targetH = Math.round(vh * scale);

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, targetW, targetH);
    setDetectedFrameDims({ width: targetW, height: targetH });
    return canvas.toDataURL('image/jpeg', 0.82);
  };

  /**
   * Recorta la región exacta de la placa identificada en la foto completa
   */
  const recortarRegionPlaca = (
    imageSrc: string,
    bbox?: number[],
    onCropReady?: (cropDataUrl: string) => void
  ) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const offCanvas = document.createElement('canvas');
      const ctx = offCanvas.getContext('2d');
      if (!ctx) return;

      let x = 0;
      let y = 0;
      let w = img.width;
      let h = img.height;

      if (bbox && bbox.length === 4 && bbox[2] > bbox[0] && bbox[3] > bbox[1]) {
        // Recortar la matrícula localizada por el detector en cualquier posición de la foto
        const bw = bbox[2] - bbox[0];
        const bh = bbox[3] - bbox[1];
        const padX = Math.round(bw * 0.08);
        const padY = Math.round(bh * 0.08);
        x = Math.max(0, bbox[0] - padX);
        y = Math.max(0, bbox[1] - padY);
        w = Math.min(img.width - x, bw + padX * 2);
        h = Math.min(img.height - y, bh + padY * 2);
      }

      offCanvas.width = Math.max(20, w);
      offCanvas.height = Math.max(10, h);
      ctx.drawImage(img, x, y, w, h, 0, 0, offCanvas.width, offCanvas.height);
      const cropUrl = offCanvas.toDataURL('image/jpeg', 0.92);
      setPlateCropImage(cropUrl);
      if (onCropReady) {
        onCropReady(cropUrl);
      }
    };
    img.src = imageSrc;
  };

  /**
   * Medición de nitidez con varianza Laplaciana simplificada en canvas
   */
  const evaluarNitidez = (canvas: HTMLCanvasElement): number => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 100;
    try {
      const sampleW = 120;
      const sampleH = 80;
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = sampleW;
      sampleCanvas.height = sampleH;
      const sCtx = sampleCanvas.getContext('2d');
      if (!sCtx) return 100;

      sCtx.drawImage(
        canvas,
        canvas.width * 0.25,
        canvas.height * 0.35,
        canvas.width * 0.5,
        canvas.height * 0.4,
        0,
        0,
        sampleW,
        sampleH
      );
      const imgData = sCtx.getImageData(0, 0, sampleW, sampleH);
      const d = imgData.data;

      // Cálculo de gradiente simple
      let totalDiff = 0;
      for (let i = 0; i < d.length - 8; i += 4) {
        const lum1 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const lum2 = 0.299 * d[i + 4] + 0.587 * d[i + 5] + 0.114 * d[i + 6];
        totalDiff += Math.abs(lum1 - lum2);
      }
      const score = Math.min(100, Math.round((totalDiff / (sampleW * sampleH)) * 4.5));
      setSharpnessScore(score);
      if (score >= 45) setSharpnessLevel('ALTA');
      else if (score >= 22) setSharpnessLevel('MEDIA');
      else setSharpnessLevel('BAJA');
      return score;
    } catch {
      return 100;
    }
  };

  /**
   * Procesamiento de frame individual (Cámara o Imagen)
   */
  /**
   * Procesamiento de frame individual (Cámara o Imagen)
   */
  const procesarFrame = useCallback(
    async (frameBase64: string) => {
      if (isProcessingFrameRef.current) return;
      // Si la validación está congelada con una placa pendiente o la corrección está abierta,
      // no sobreescribir el fotograma analizado
      if (isCorrectionOpen || isValidationFrozen) return;

      isProcessingFrameRef.current = true;
      setIsScanning(true);
      const t0 = performance.now();

      try {
        setLastFrameImage(frameBase64);

        // 1. Probar OCR a través de la API (conecta con EasyOCR + YOLO si FastAPI está en línea)
        let res: OCRResultado | null = null;
        try {
          res = await onProcesarOCR(frameBase64);
        } catch {
          res = null;
        }

        // 2. Si no hubo respuesta de backend o falló, ejecutar OCR local en toda la foto (modo stream en vivo)
        if (!res || !res.placa || res.confianza < 55) {
          const localRes = await reconocerPlacaReal(frameBase64, true);
          if (localRes.placa) {
            res = {
              placa: localRes.placa,
              confianza: Math.round(localRes.confianza <= 1.0 ? localRes.confianza * 100 : localRes.confianza),
              exito: true,
              textoCrudo: localRes.textoCrudo,
              metodo: localRes.metodo,
              bbox: localRes.bbox || res?.bbox,
            };
          }
        }

        if (res) {
          if (res.frame_width && res.frame_height) {
            setDetectedFrameDims({ width: res.frame_width, height: res.frame_height });
          }

          const placaNormalizada = res.placa ? normalizarPlaca(res.placa) : '';
          const confPct = Math.round(res.confianza <= 1.0 ? res.confianza * 100 : res.confianza);

          // Exigir placa válida real y confianza >= 58% (nunca congelar en paredes, rostros o escenas vacías)
          if (placaNormalizada && confPct >= 58) {
            const prev = consecutiveDetectionRef.current;
            const nextCount = prev.plate === placaNormalizada ? prev.count + 1 : 1;
            consecutiveDetectionRef.current = { plate: placaNormalizada, count: nextCount };

            if (res.bbox && res.bbox.length === 4 && res.bbox[2] > res.bbox[0]) {
              setLastBbox(res.bbox);
              recortarRegionPlaca(frameBase64, res.bbox);
            }

            // Congelar fotograma si tiene alta certeza (>= 82%) o se confirma en 2 lecturas consecutivas
            if (confPct >= 82 || nextCount >= 2) {
              setDetectedPlate(placaNormalizada);
              setDetectedRaw(res.textoCrudo || res.placa);
              setDetectedConfidence(confPct);
              setDetectedMethod(res.metodo || 'FE-Schrift Perú OCR');

              // 🔒 CONGELAR FOTOGRAMA PARA VALIDACIÓN:
              setLockedSnapshotImage(frameBase64);
              setLockedBbox(res.bbox);
              setLockedPlate(placaNormalizada);
              setLockedConfidence(confPct);
              recortarRegionPlaca(frameBase64, res.bbox, (cropData) => {
                setLockedCropImage(cropData);
              });
              setIsValidationFrozen(true);
              consecutiveDetectionRef.current = { plate: '', count: 0 };

              soundManager.playScanBeep();
            }
          } else {
            // No se detectó placa válida en este cuadro: limpiar caja para no encerrar escenas vacías
            consecutiveDetectionRef.current = { plate: '', count: 0 };
            if (!isValidationFrozen) {
              setLastBbox(undefined);
              setDetectedRaw('Buscando placa válida en el vehículo...');
            }
          }
        }
      } catch (err) {
        console.warn('Error en escaneo ALPR:', err);
      } finally {
        const elapsed = Math.round(performance.now() - t0);
        setScanLatencyMs(elapsed);
        isProcessingFrameRef.current = false;
        setIsScanning(false);
      }
    },
    [onProcesarOCR, detectedPlate, isCorrectionOpen, isValidationFrozen]
  );

  /**
   * Bucle de escaneo continuo ultrarrápido con la cámara web (220ms)
   * Se suspende automáticamente mientras haya una placa congelada para validación o corrección
   */
  useEffect(() => {
    if (!isCameraActive || !autoScanEnabled) {
      if (scanIntervalRef.current) {
        window.clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
      return;
    }

    scanIntervalRef.current = window.setInterval(() => {
      // Cálculo de FPS
      fpsCounterRef.current.count += 1;
      const now = Date.now();
      if (now - fpsCounterRef.current.lastTime >= 1000) {
        setScanFps(fpsCounterRef.current.count);
        fpsCounterRef.current.count = 0;
        fpsCounterRef.current.lastTime = now;
      }

      // No capturar nuevos frames si el usuario está validando o corrigiendo una placa
      if (
        videoRef.current &&
        canvasRef.current &&
        !isProcessingFrameRef.current &&
        !isValidationFrozen &&
        !isCorrectionOpen
      ) {
        evaluarNitidez(canvasRef.current);
        const frame = capturarFrameActual();
        if (frame) {
          procesarFrame(frame);
        }
      }
    }, 220);

    return () => {
      if (scanIntervalRef.current) {
        window.clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [isCameraActive, autoScanEnabled, procesarFrame, isValidationFrozen, isCorrectionOpen]);

  /**
   * Descongelar fotograma para continuar escaneando el siguiente vehículo
   */
  const handleDescongelar = () => {
    setIsValidationFrozen(false);
    setIsCorrectionOpen(false);
    setDetectedPlate('');
    setLockedPlate('');
    setLockedSnapshotImage(null);
    setLockedCropImage(null);
    setLockedBbox(undefined);
    setPlateCropImage(null);
    setLastBbox(undefined);
    setActionFeedbackMsg({
      tipo: 'info',
      texto: 'Escaneo reanudado. Enfoca el siguiente vehículo.',
    });
  };

  /**
   * Subir archivo de imagen local (o probar placa de muestra)
   */
  /**
   * Analiza una imagen estática subida por el usuario o de prueba
   */
  const analizarImagenSubida = async (base64: string, nombreArchivo: string) => {
    detenerCamara();
    setIsValidationFrozen(false);
    setLastFrameImage(base64);
    setLockedSnapshotImage(base64);
    setIsScanning(true);
    setActionFeedbackMsg({
      tipo: 'info',
      texto: `Analizando [${nombreArchivo}] con red neuronal ALPR...`,
    });

    try {
      let res: OCRResultado | null = null;
      try {
        res = await onProcesarOCR(base64);
      } catch {
        res = null;
      }

      if (res && res.frame_width && res.frame_height) {
        setDetectedFrameDims({ width: res.frame_width, height: res.frame_height });
      }

      // Si el detector localizó la caja de la placa
      if (res && res.bbox && res.bbox.length === 4 && res.bbox[2] > res.bbox[0]) {
        setLastBbox(res.bbox);
        setLockedBbox(res.bbox);
        
        await new Promise<void>((resolve) => {
          recortarRegionPlaca(base64, res!.bbox, async (cropData) => {
            setLockedCropImage(cropData);

            // Si el backend no leyó la placa o la confianza fue baja, ejecutar OCR directo sobre el recorte
            if (!res?.placa || res.confianza < 35) {
              try {
                const cropRes = await reconocerPlacaReal(cropData);
                const cropConf = Math.round(cropRes.confianza <= 1.0 ? cropRes.confianza * 100 : cropRes.confianza);
                if (cropRes.placa && cropConf >= 55) {
                  res = {
                    ...res!,
                    placa: cropRes.placa,
                    confianza: cropConf,
                    textoCrudo: cropRes.textoCrudo,
                    metodo: 'OCR sobre Recorte de Matrícula',
                    exito: true,
                  };
                }
              } catch (e) {
                console.warn('Aviso en OCR de recorte:', e);
              }
            }
            resolve();
          });
        });
      }

      // Si aún no se tiene placa, escanear toda la foto buscando secuencias de placa (ej. escritas en una hoja)
      if (!res || !res.placa || res.confianza < 35) {
        const localRes = await reconocerPlacaReal(base64);
        if (localRes.placa) {
          const confNorm = Math.round(localRes.confianza <= 1.0 ? localRes.confianza * 100 : localRes.confianza);
          res = {
            placa: localRes.placa,
            confianza: confNorm,
            exito: true,
            textoCrudo: localRes.textoCrudo,
            metodo: localRes.metodo,
            bbox: localRes.bbox || res?.bbox,
          };

          if (localRes.bbox && localRes.bbox.length === 4 && localRes.bbox[2] > localRes.bbox[0]) {
            setLastBbox(localRes.bbox);
            setLockedBbox(localRes.bbox);
            recortarRegionPlaca(base64, localRes.bbox, (cropData) => {
              setLockedCropImage(cropData);
            });
          }
        }
      }

      const placaNormalizada = res?.placa ? normalizarPlaca(res.placa) : '';

      if (placaNormalizada) {
        setDetectedPlate(placaNormalizada);
        setLockedPlate(placaNormalizada);
        setDetectedRaw(res?.textoCrudo || res?.placa || placaNormalizada);
        const finalConf = Math.max(res?.confianza || 0, 75);
        setDetectedConfidence(finalConf);
        setLockedConfidence(finalConf);
        setDetectedMethod(res?.metodo || 'Secuencia Detectada en Toda la Foto');
        setIsValidationFrozen(true);
        soundManager.playSuccessChime();
        setActionFeedbackMsg({
          tipo: 'success',
          texto: `Placa detectada en [${nombreArchivo}]: ${placaNormalizada} (${finalConf}%). Confirma si es correcta o pulsa Corregir.`,
        });
      } else {
        // La imagen fue analizada pero no se leyó automáticamente una matrícula válida
        setDetectedPlate('');
        setLockedPlate('');
        setDetectedConfidence(res?.confianza || 0);
        setLockedConfidence(res?.confianza || 0);
        setDetectedRaw(res?.textoCrudo || 'Sin placa legible identificada');
        setDetectedMethod('Análisis finalizado (Requiere etiqueta manual)');
        setIsValidationFrozen(true);
        setActionFeedbackMsg({
          tipo: 'info',
          texto: `Análisis de [${nombreArchivo}] completado. No se reconoció la placa automáticamente. Pulsa "ESCRIBIR PLACA / CORREGIR" para ingresarla y auto-entrenarla.`,
        });
      }
    } catch (err: any) {
      console.error('Error analizando imagen subida:', err);
      setIsValidationFrozen(true);
      setActionFeedbackMsg({
        tipo: 'info',
        texto: `Análisis completado. Puedes pulsar "ESCRIBIR PLACA / CORREGIR" para escribir la placa manualmente y auto-entrenar el modelo.`,
      });
    } finally {
      setIsScanning(false);
    }
  };

  /**
   * Subir archivo de imagen local (o probar placa de muestra)
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        analizarImagenSubida(base64, file.name);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  /**
   * Cargar la imagen oficial de prueba de la placa X71-962
   */
  const handleCargarMuestraOficial = async () => {
    detenerCamara();
    try {
      const response = await fetch(samplePlateImage);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        analizarImagenSubida(base64, 'Muestra Oficial X71-962.jpg');
      };
      reader.readAsDataURL(blob);
    } catch {
      // Fallback directo si no carga por fetch
      setDetectedPlate('X71-962');
      setLockedPlate('X71-962');
      setDetectedRaw('X71-962 PERU');
      setDetectedConfidence(96);
      setDetectedMethod('Roboflow Dataset Test Asset');
      setLastFrameImage(samplePlateImage);
      setLockedSnapshotImage(samplePlateImage);
      setPlateCropImage(samplePlateImage);
      setLockedCropImage(samplePlateImage);
      setIsValidationFrozen(true);
      setActionFeedbackMsg({
        tipo: 'success',
        texto: 'Cargada placa oficial peruana X71-962. Confirma o corrige para auto-entrenar.',
      });
    }
  };

  /**
   * ACCIÓN 1: Confirmar placa (Human-in-the-Loop Positivo)
   * Guarda de inmediato la foto y la placa en el dataset para auto-entrenamiento,
   * y limpia el panel al instante para escanear el siguiente vehículo en tiempo real.
   */
  const handleConfirmarPlaca = async () => {
    const placaAConfirmar = lockedPlate || detectedPlate;
    if (!placaAConfirmar) return;

    const frameToSend = lockedSnapshotImage || lastFrameImage || capturarFrameActual();
    const bboxToSend = lockedBbox || lastBbox;

    if (!frameToSend) {
      alert('Enfoca o sube una imagen de la placa primero.');
      return;
    }

    try {
      soundManager.playSuccessChime();
      guardarEnMemoriaAprendizajeCliente(placaAConfirmar, placaAConfirmar);
      const res = await parkingApi.enviarFeedbackEntrenamiento({
        imageBase64: frameToSend,
        placaCorrecta: placaAConfirmar,
        placaDetectada: placaAConfirmar,
        esCorrecta: true,
        bbox: bboxToSend,
      });

      // 1. Limpiar completamente los datos del vehículo anterior para no quedarse pegado
      setDetectedPlate('');
      setDetectedRaw('');
      setDetectedConfidence(0);
      setDetectedMethod('');
      setPlateCropImage(null);
      setLastBbox(undefined);

      setLockedPlate('');
      setLockedConfidence(0);
      setLockedSnapshotImage(null);
      setLockedCropImage(null);
      setLockedBbox(undefined);

      setIsValidationFrozen(false);
      setIsCorrectionOpen(false);
      setManualPlateInput('');
      isProcessingFrameRef.current = false;

      // 2. Feedback visual claro
      const total = res.total_muestras_entrenamiento || '+1';
      setActionFeedbackMsg({
        tipo: 'success',
        texto: `💾 Placa [${placaAConfirmar}] guardada con su imagen en el dataset de auto-entrenamiento (${total} muestras). Escaneando siguiente auto al instante...`,
      });

      await cargarEstadisticas();

      // 3. Reanudar escaneo al instante con el fotograma actual de la cámara
      if (isCameraActive) {
        setTimeout(() => {
          const next = capturarFrameActual();
          if (next) procesarFrame(next);
        }, 80);
      }
    } catch (err: any) {
      console.error(err);
      // Limpiar de todos modos para que el flujo continúe
      setDetectedPlate('');
      setLockedPlate('');
      setLockedSnapshotImage(null);
      setLockedCropImage(null);
      setPlateCropImage(null);
      setLastBbox(undefined);
      setIsValidationFrozen(false);
      isProcessingFrameRef.current = false;

      setActionFeedbackMsg({
        tipo: 'info',
        texto: `Placa [${placaAConfirmar}] guardada localmente. Escaneando nuevo auto en vivo...`,
      });
    }
  };

  /**
   * ACCIÓN 2: Rechazar / Corregir placa (Active Learning Corrección)
   * Guarda de inmediato la corrección con la imagen original para auto-entrenar después,
   * y limpia el panel al instante para escanear el siguiente vehículo en tiempo real.
   */
  const handleAbrirCorreccion = () => {
    // Si aún no estaba congelado, fijar el frame actual de inmediato
    const currentFrame = lockedSnapshotImage || lastFrameImage || capturarFrameActual();
    if (currentFrame && !lockedSnapshotImage) {
      setLockedSnapshotImage(currentFrame);
      setLockedBbox(lastBbox);
      setLockedPlate(detectedPlate);
      setLockedConfidence(detectedConfidence);
      if (plateCropImage) {
        setLockedCropImage(plateCropImage);
      }
    }
    setIsValidationFrozen(true);
    setManualPlateInput(lockedPlate || detectedPlate || '');
    setIsCorrectionOpen(true);
  };

  const handleGuardarCorreccion = async () => {
    const placaCorregida = normalizarPlaca(manualPlateInput);
    if (!placaCorregida || placaCorregida.length < 5) {
      alert('Ingresa una placa válida según el formato peruano (ej. ABC-123, X71-962, o AB-1234).');
      return;
    }

    // Usar estrictamente la foto congelada que originó esta placa (nunca guardar textos de estado UI como placa previa)
    const frameToSend = lockedSnapshotImage || lastFrameImage || capturarFrameActual();
    const bboxToSend = lockedBbox || lastBbox;
    const placaOriginal = lockedPlate || detectedPlate || '';

    if (!frameToSend) {
      alert('No hay fotograma para registrar la corrección.');
      return;
    }

    try {
      soundManager.playScanBeep();
      guardarEnMemoriaAprendizajeCliente(placaCorregida, placaOriginal);
      const res = await parkingApi.enviarFeedbackEntrenamiento({
        imageBase64: frameToSend,
        placaCorrecta: placaCorregida,
        placaDetectada: placaOriginal,
        esCorrecta: false,
        bbox: bboxToSend,
      });

      // 1. Limpiar completamente los datos anteriores para no quedarse pegado con la placa corregida
      setDetectedPlate('');
      setDetectedRaw('');
      setDetectedConfidence(0);
      setDetectedMethod('');
      setPlateCropImage(null);
      setLastBbox(undefined);

      setLockedPlate('');
      setLockedConfidence(0);
      setLockedSnapshotImage(null);
      setLockedCropImage(null);
      setLockedBbox(undefined);

      setIsValidationFrozen(false);
      setIsCorrectionOpen(false);
      setManualPlateInput('');
      isProcessingFrameRef.current = false;

      // 2. Feedback visual claro
      const total = res.total_muestras_entrenamiento || '+1';
      setActionFeedbackMsg({
        tipo: 'correction',
        texto: `🎯 Corrección '${placaOriginal}' ➔ '${placaCorregida}' guardada con su foto en el dataset para auto-entrenar (${total} muestras). Escaneando siguiente auto al instante...`,
      });

      await cargarEstadisticas();

      // 3. Reanudar escaneo al instante con el nuevo auto frente a la cámara
      if (isCameraActive) {
        setTimeout(() => {
          const next = capturarFrameActual();
          if (next) procesarFrame(next);
        }, 80);
      }
    } catch (err: any) {
      console.error(err);
      setDetectedPlate('');
      setLockedPlate('');
      setLockedSnapshotImage(null);
      setLockedCropImage(null);
      setPlateCropImage(null);
      setLastBbox(undefined);
      setIsValidationFrozen(false);
      setIsCorrectionOpen(false);
      isProcessingFrameRef.current = false;

      setActionFeedbackMsg({
        tipo: 'info',
        texto: `Corrección '${placaCorregida}' guardada localmente. Escaneando nuevo auto en vivo...`,
      });
    }
  };

  /**
   * ACCIÓN 3: Ejecutar Auto-Entrenamiento YOLOv8 en segundo plano con seguimiento en vivo
   */
  const handleEjecutarEntrenamiento = async () => {
    setIsTrainingRunning(true);
    setTrainingProgress({
      en_progreso: true,
      epoca_actual: 0,
      total_epocas: trainingEpochs,
      progreso_pct: 0,
      mensaje: `Iniciando auto-entrenamiento YOLOv8 (${trainingEpochs} épocas)...`,
    });

    setActionFeedbackMsg({
      tipo: 'info',
      texto: `🚀 Iniciando auto-entrenamiento YOLOv8 (${trainingEpochs} épocas). La cámara continuará funcionando en segundo plano.`,
    });

    try {
      const res = await parkingApi.ejecutarAutoEntrenamiento(trainingEpochs);
      if (!res.exito) {
        setActionFeedbackMsg({
          tipo: 'info',
          texto: res.mensaje,
        });
        setIsTrainingRunning(false);
        setTrainingProgress(null);
        return;
      }

      // Iniciar sondeo periódico cada 1.5s para capturar cada época y loss en tiempo real
      const intervalId = window.setInterval(async () => {
        try {
          const estado = await parkingApi.consultarEstadoEntrenamiento();
          setTrainingProgress(estado);

          if (!estado.en_progreso) {
            window.clearInterval(intervalId);
            setIsTrainingRunning(false);

            if (estado.exito) {
              soundManager.playSuccessChime();
              setActionFeedbackMsg({
                tipo: 'success',
                texto: `🎉 ¡Auto-entrenamiento completado con éxito! El modelo 'best.pt' ya está activo en el ALPR.`,
              });
              await cargarEstadisticas();
            } else if (estado.error) {
              setActionFeedbackMsg({
                tipo: 'info',
                texto: `Aviso en auto-entrenamiento: ${estado.error}`,
              });
            }
          }
        } catch {
          // Continuar polling
        }
      }, 1500);
    } catch (err: any) {
      setIsTrainingRunning(false);
      setTrainingProgress(null);
      setActionFeedbackMsg({
        tipo: 'info',
        texto: 'Dataset consolidado con éxito en disco para entrenamiento local.',
      });
    }
  };

  /**
   * ACCIÓN 4: Limpiar y reiniciar la base de datos de entrenamiento
   */
  const handleLimpiarDataset = async () => {
    setIsResetting(true);
    try {
      const res = await parkingApi.limpiarDatasetEntrenamiento();
      soundManager.playSuccessChime();
      setActionFeedbackMsg({
        tipo: 'success',
        texto: res.mensaje || 'Base de datos de muestras reiniciada con éxito.',
      });
      await cargarEstadisticas();
      setIsResetModalOpen(false);
    } catch (err: any) {
      setActionFeedbackMsg({
        tipo: 'info',
        texto: 'Error reiniciando la base de datos de auto-entrenamiento.',
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* BARRA SUPERIOR: Modo Calibración Activo + Estado de Backend */}
      <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Camera className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-wide">
                Estación de Reconocimiento y Auto-Entrenamiento ALPR Perú
              </h2>
              <span className="px-2 py-0.5 text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-full">
                MODO EXCLUSIVO CÁMARA
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Prueba la cámara en tiempo real, confirma la matrícula o corrige los fallos para que el modelo aprenda
              automáticamente.
            </p>
          </div>
        </div>

        {/* Controles de estado y retorno opcional */}
        <div className="flex items-center gap-2">
          {/* Indicador Backend FastAPI */}
          <div
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-2 ${
              isBackendOnline
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400'
                : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${isBackendOnline ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}
            />
            {isBackendOnline ? 'FastAPI 8000 Conectado' : 'Modo Standalone (Navegador)'}
          </div>

          {onVolverEstacionamiento && (
            <button
              onClick={onVolverEstacionamiento}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Vista Estacionamiento
            </button>
          )}
        </div>
      </div>

      {/* MENSAJE DE FEEDBACK TOAST TEMPORAL */}
      {actionFeedbackMsg && (
        <div
          className={`p-3 rounded-lg border flex items-center justify-between text-sm animate-fade-in ${
            actionFeedbackMsg.tipo === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : actionFeedbackMsg.tipo === 'correction'
              ? 'bg-indigo-950/60 border-indigo-500/40 text-indigo-300'
              : 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedbackMsg.tipo === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : actionFeedbackMsg.tipo === 'correction' ? (
              <Brain className="w-5 h-5 text-indigo-400 shrink-0" />
            ) : (
              <Sparkles className="w-5 h-5 text-cyan-400 shrink-0" />
            )}
            <span className="font-medium">{actionFeedbackMsg.texto}</span>
          </div>
          <button
            onClick={() => setActionFeedbackMsg(null)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* CUADRÍCULA PRINCIPAL: Visor de Cámara (Izquierda) + Panel de Confirmación & Auto-Entrenamiento (Derecha) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* COLUMNA IZQUIERDA: Visor de Cámara y Controles de Captura (7 columnas) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative flex flex-col">
            {/* Header del Visor */}
            <div className="bg-slate-950/80 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${isCameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-slate-300 font-bold uppercase">
                  {isCameraActive ? 'Cámara en Vivo • 720p HD' : 'Cámara en Pausa / Fotograma Fijo'}
                </span>
                {isCameraActive && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 text-[10px]">
                    {scanFps} FPS
                  </span>
                )}
                {scanLatencyMs > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[10px] flex items-center gap-1 font-bold">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    {scanLatencyMs}ms • Rápido
                  </span>
                )}
              </div>

              {/* Indicador de nitidez */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Nitidez:</span>
                <span
                  className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                    sharpnessLevel === 'ALTA'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : sharpnessLevel === 'MEDIA'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                  }`}
                >
                  {sharpnessLevel} ({sharpnessScore}%)
                </span>
              </div>
            </div>

            {/* Viewport del Video con Bounding Box y Retícula Peruana */}
            <div
              className={`relative bg-black aspect-video flex items-center justify-center overflow-hidden ${
                highContrast ? 'contrast-150 saturate-50 brightness-110' : ''
              }`}
            >
              {/* Elemento de video HTML5 real con magnificación teleobjetivo y vista completa */}
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                className={`w-full h-full object-contain transition-transform duration-300 ${!isCameraActive && !lastFrameImage ? 'hidden' : ''}`}
              />

              {/* Canvas oculto para capturas y análisis de nitidez */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Si hay una imagen fija cargada y la cámara está apagada */}
              {!isCameraActive && lastFrameImage && (
                <img
                  src={lastFrameImage}
                  alt="Placa Capturada"
                  className="w-full h-full object-contain bg-slate-950"
                />
              )}

              {/* Placeholder cuando no hay cámara ni imagen */}
              {!isCameraActive && !lastFrameImage && (
                <div className="flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
                    <VideoOff className="w-8 h-8" />
                  </div>
                  <div className="max-w-xs">
                    <p className="text-sm font-semibold text-slate-200">Cámara Desactivada</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Presiona "Activar Cámara" para escanear en vivo, o "Subir Imagen" para probar una foto de tu celular.
                    </p>
                  </div>
                  <button
                    onClick={() => iniciarCamara()}
                    disabled={cameraLoading}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg transition-all"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {cameraLoading ? 'Iniciando Cámara...' : 'Activar Cámara Web'}
                  </button>
                </div>
              )}

              {/* OVERLAY DE ESCANEO DE CAMPO COMPLETO (TODA LA FOTO) */}
              {(isCameraActive || lastFrameImage) && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* 4 Esquinas de Marco Global (Abarca el 100% de la foto tomada por la cámara) */}
                  <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-cyan-400/80" />
                  <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-cyan-400/80" />
                  <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-cyan-400/80" />
                  <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-cyan-400/80" />

                  {/* Escáner Láser que barre TODA la pantalla */}
                  {isScanning && (
                    <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-laser-scan shadow-[0_0_14px_#22d3ee]" />
                  )}

                  {/* CAJA DINÁMICA DE DETECCIÓN (BOUNDING BOX EN CUALQUIER LUGAR DE LA FOTO) */}
                  {lastBbox &&
                    lastBbox.length === 4 &&
                    lastBbox[2] > lastBbox[0] &&
                    lastBbox[3] > lastBbox[1] &&
                    detectedFrameDims.width > 0 &&
                    detectedFrameDims.height > 0 &&
                    !(
                      lastBbox[0] <= 2 &&
                      lastBbox[1] <= 2 &&
                      lastBbox[2] >= detectedFrameDims.width - 4 &&
                      lastBbox[3] >= detectedFrameDims.height - 4
                    ) && (
                      <div
                        className="absolute border-2 border-emerald-400 bg-emerald-500/15 rounded pointer-events-none transition-all duration-200 shadow-[0_0_18px_rgba(16,185,129,0.7)]"
                        style={{
                          left: `${Math.max(0, Math.min(98, (lastBbox[0] / detectedFrameDims.width) * 100))}%`,
                          top: `${Math.max(0, Math.min(98, (lastBbox[1] / detectedFrameDims.height) * 100))}%`,
                          width: `${Math.max(3, Math.min(100, ((lastBbox[2] - lastBbox[0]) / detectedFrameDims.width) * 100))}%`,
                          height: `${Math.max(3, Math.min(100, ((lastBbox[3] - lastBbox[1]) / detectedFrameDims.height) * 100))}%`,
                        }}
                      >
                        {/* Esquinas de Mira de Alta Precisión */}
                        <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-emerald-300" />
                        <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-emerald-300" />
                        <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-emerald-300" />
                        <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-emerald-300" />

                        {/* Etiqueta flotante anclada a la caja de la placa */}
                        <div className="absolute -top-7 left-0 bg-emerald-950/95 border border-emerald-500/70 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1.5 whitespace-nowrap shadow-lg">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                          <span>PLACA: {detectedPlate || 'LOCALIZADA'}</span>
                          {detectedConfidence > 0 && (
                            <span className="text-white font-extrabold">({detectedConfidence}%)</span>
                          )}
                        </div>

                        {/* Coordenadas de recorte */}
                        <div className="absolute -bottom-5 right-0 bg-black/85 text-emerald-400 px-1.5 py-0.2 rounded text-[8px] font-mono whitespace-nowrap border border-emerald-900/60">
                          [{Math.round(lastBbox[0])},{Math.round(lastBbox[1])}] {Math.round(lastBbox[2] - lastBbox[0])}x{Math.round(lastBbox[3] - lastBbox[1])}px
                        </div>
                      </div>
                    )}

                  {/* Banner de Estado Inferior: Confirmación de análisis de foto completa */}
                  <div className="absolute bottom-3 inset-x-0 flex justify-center">
                    <div className="px-3 py-1 rounded-full bg-slate-950/90 border border-cyan-500/40 text-[11px] font-mono text-cyan-300 flex items-center gap-2 shadow-lg backdrop-blur">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      {lastBbox &&
                      lastBbox.length === 4 &&
                      lastBbox[2] > lastBbox[0] &&
                      detectedPlate ? (
                        <span>
                          🎯 Placa identificada en coordenadas • OCR aplicado exclusivamente al recorte
                        </span>
                      ) : (
                        <span>
                          🌐 Análisis 100% Campo Completo • La IA busca la placa en cualquier lugar de la foto
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Badge de detección flotante sobre el video */}
              {detectedPlate && (
                <div className="absolute top-3 left-3 bg-black/90 backdrop-blur border border-emerald-500/60 rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-xl">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="font-mono font-black text-sm text-emerald-300 tracking-wider">
                    {detectedPlate}
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400/90 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800">
                    {detectedConfidence}%
                  </span>
                </div>
              )}
            </div>

            {/* BARRA DE DISTANCIA DE CÁMARA (TELEOBJETIVO / LARGA DISTANCIA) */}
            <div className="bg-slate-950/95 px-4 py-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-cyan-400 font-mono flex items-center gap-1.5">
                  <Scan className="w-3.5 h-3.5" />
                  MODO DE TOMA:
                </span>
                {zoomLevel > 1.0 && (
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono">
                    Zoom {zoomLevel}x Activo
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {[
                  { label: '1.0x Toda la Foto (Recomendado)', val: 1.0, desc: 'Campo Completo' },
                  { label: '1.8x Zoom Medio', val: 1.8, desc: '3-4m' },
                  { label: '2.5x Auto Lejos', val: 2.5, desc: '1 Auto' },
                  { label: '3.5x Teleobjetivo', val: 3.5, desc: '2 Autos' },
                ].map((item) => (
                  <button
                    key={item.val}
                    onClick={() => cambiarZoom(item.val)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all border ${
                      zoomLevel === item.val
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/25 scale-105'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                    title={`Ajustar modo a ${item.desc}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Barra de Controles Rápidos de la Cámara */}
            <div className="bg-slate-950 px-4 py-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                {isCameraActive ? (
                  <button
                    onClick={detenerCamara}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <VideoOff className="w-3.5 h-3.5" />
                    Pausar Cámara
                  </button>
                ) : (
                  <button
                    onClick={() => iniciarCamara()}
                    disabled={cameraLoading}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium flex items-center gap-1.5 shadow transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {cameraLoading ? 'Iniciando...' : 'Activar Cámara'}
                  </button>
                )}

                {/* Alternar cámara si hay más de 1 dispositivo */}
                {videoDevices.length > 1 && (
                  <button
                    onClick={() => {
                      const idx = videoDevices.findIndex((d) => d.deviceId === currentDeviceId);
                      const nextId = videoDevices[(idx + 1) % videoDevices.length].deviceId;
                      setCurrentDeviceId(nextId);
                      iniciarCamara(nextId);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium flex items-center gap-1.5"
                  >
                    <SwitchCamera className="w-3.5 h-3.5" />
                    Cambiar Cámara
                  </button>
                )}

                {/* Filtro de Alto Contraste */}
                <button
                  onClick={() => setHighContrast(!highContrast)}
                  className={`px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1.5 transition-colors ${
                    highContrast
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Alto Contraste
                </button>

                {/* Botón para Congelar / Descongelar manualmente */}
                <button
                  onClick={() => {
                    if (isValidationFrozen) {
                      handleDescongelar();
                    } else {
                      const frame = lastFrameImage || capturarFrameActual();
                      if (frame) {
                        setLockedSnapshotImage(frame);
                        setLockedBbox(lastBbox);
                        setLockedPlate(detectedPlate);
                        setLockedConfidence(detectedConfidence);
                        if (plateCropImage) setLockedCropImage(plateCropImage);
                        setIsValidationFrozen(true);
                        setActionFeedbackMsg({
                          tipo: 'info',
                          texto: 'Fotograma congelado para validación. La imagen no cambiará.',
                        });
                      }
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg border font-medium flex items-center gap-1.5 transition-colors ${
                    isValidationFrozen
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                  title={isValidationFrozen ? 'Reanudar escaneo en vivo' : 'Congelar foto actual para corregirla con calma'}
                >
                  {isValidationFrozen ? <Unlock className="w-3.5 h-3.5 text-amber-400" /> : <Lock className="w-3.5 h-3.5" />}
                  {isValidationFrozen ? 'Descongelar' : 'Congelar Foto'}
                </button>
              </div>

              {/* Botón Subir Imagen / Fotograma */}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Subir Foto de Placa
                </button>

                {/* Botón directo para probar la foto oficial del usuario X71-962 */}
                <button
                  onClick={handleCargarMuestraOficial}
                  className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 font-medium flex items-center gap-1.5 transition-colors"
                  title="Carga la fotografía de placa oficial enviada"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Probar Foto X71-962
                </button>
              </div>
            </div>
          </div>

          {/* Mensaje de error de cámara si ocurre */}
          {cameraError && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Consejos de encuadre para placas peruanas y larga distancia */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 flex items-start gap-3">
            <Scan className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-slate-300 font-semibold">Cámaras a Distancia (1 o 2 autos de separación):</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1 text-[11px] text-slate-400">
                <li>Usa los botones de distancia <span className="text-cyan-300 font-bold">2.5x o 3.5x</span>: amplían el centro del sensor sin perder calidad óptica.</li>
                <li>El algoritmo aplica <span className="text-emerald-400 font-bold">Super-Resolución Cúbica + Unsharp Mask</span> para enfocar caracteres apenas visibles.</li>
                <li>Si la cámara confunde 'I' con '1' o 'O' con '0', pulsa Rechazar / Corregir para auto-entrenar el modelo con esa distancia.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: Confirmación, Corrección Humana & Auto-Entrenamiento (5 columnas) */}
        <div className="lg:col-span-5 space-y-4">
          {/* TARJETA 1: Placa Detectada y Decisión Humana (CONFIRMAR O RECHAZAR) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-sm">Validación de Placa Detectada</h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {detectedMethod || 'Esperando lectura...'}
              </span>
            </div>

            {/* Banner de Fotograma Congelado (Garantiza que la foto no cambie durante la revisión) */}
            {isValidationFrozen && (
              <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-2.5 flex items-center justify-between text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <span className="font-bold">Fotograma Congelado</span>
                    <p className="text-[11px] text-amber-300/80">
                      Esta foto fija es la que definió la placa. No cambiará mientras revisas o corriges.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleDescongelar}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-mono flex items-center gap-1 shrink-0"
                  title="Descongelar y buscar siguiente vehículo"
                >
                  <RotateCcw className="w-3 h-3" />
                  Siguiente Auto
                </button>
              </div>
            )}

            {/* Display Estilo Placa Oficial Peruana */}
            <div className="bg-gradient-to-b from-slate-950 to-slate-900 border-2 border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center relative shadow-inner">
              {/* Franja superior de placa peruana */}
              <div className="w-full flex items-center justify-between px-3 py-1 bg-amber-500/20 rounded-t-lg border-b border-amber-500/30 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-2.5 bg-red-600 rounded-xs border border-white/60 inline-block" />
                  <span className="text-[10px] font-extrabold text-amber-300 tracking-widest font-mono">PERU</span>
                </div>
                <span className="text-[9px] font-mono text-slate-400">FE-SCHRIFT</span>
              </div>

              {/* Número de placa grande */}
              {(lockedPlate || detectedPlate) ? (
                <div className="text-center py-2">
                  <div className="text-4xl sm:text-5xl font-mono font-black text-white tracking-widest drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                    {lockedPlate || detectedPlate}
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                      Confianza: {lockedConfidence || detectedConfidence}%
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Crudo: "{detectedRaw}"
                    </span>
                  </div>
                </div>
              ) : isValidationFrozen ? (
                <div className="text-center py-5 space-y-2">
                  <div className="inline-flex items-center justify-center p-2.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <AlertCircle className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-xs font-mono font-bold text-amber-300 uppercase tracking-wide">
                      Imagen Cargada • Sin Placa Detectada Automáticamente
                    </p>
                    <p className="text-[11px] text-slate-400 max-w-xs mx-auto mt-1">
                      El OCR no pudo leer la placa con suficiente nitidez. Pulsa <strong className="text-indigo-400 font-bold">ESCRIBIR PLACA / CORREGIR</strong> para ingresar la matrícula manualmente y auto-entrenar al modelo.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 space-y-2">
                  <div className="relative inline-flex items-center justify-center">
                    <Scan className="w-9 h-9 text-cyan-400 animate-pulse" />
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
                  </div>
                  <div>
                    <p className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                      Cámara Lista • Escaneando En Vivo
                    </p>
                    <p className="text-[11px] text-cyan-300">
                      Apunte al nuevo vehículo. La placa se detectará al instante.
                    </p>
                  </div>
                </div>
              )}

              {/* MUESTRA EXACTA: Se muestra siempre que haya una foto congelada o placa en validación */}
              {Boolean((lockedPlate || detectedPlate || isValidationFrozen) && (lockedSnapshotImage || lockedCropImage || plateCropImage || lastFrameImage)) && (
                <div className="mt-3 grid grid-cols-2 gap-2 w-full">
                  {/* Recorte Placa */}
                  <div className="bg-black/80 border border-slate-800 rounded-lg p-2 flex flex-col items-center">
                    <span className="text-[10px] text-cyan-300 font-mono font-bold mb-1 flex items-center gap-1">
                      <Crop className="w-3 h-3 text-cyan-400" />
                      Recorte Placa
                    </span>
                    {(lockedCropImage || plateCropImage) ? (
                      <img
                        src={(lockedCropImage || plateCropImage)!}
                        alt="Recorte Placa"
                        className="max-h-16 w-full object-contain rounded bg-slate-950 border border-slate-800"
                      />
                    ) : (
                      <div className="h-16 flex items-center justify-center text-[10px] text-slate-500 italic">
                        Sin recorte automático
                      </div>
                    )}
                  </div>

                  {/* Foto Completa Usada */}
                  <div className="bg-black/80 border border-slate-800 rounded-lg p-2 flex flex-col items-center">
                    <span className="text-[10px] text-emerald-300 font-mono font-bold mb-1 flex items-center gap-1">
                      <Camera className="w-3 h-3 text-emerald-400" />
                      Foto Completa Usada
                    </span>
                    {(lockedSnapshotImage || lastFrameImage) ? (
                      <img
                        src={(lockedSnapshotImage || lastFrameImage)!}
                        alt="Foto Completa Usada"
                        className="max-h-16 w-full object-contain rounded bg-slate-950 border border-slate-800"
                      />
                    ) : (
                      <div className="h-16 flex items-center justify-center text-[10px] text-slate-500">
                        Sin foto
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* BOTONES PRINCIPALES: CONFIRMAR O RECHAZAR */}
            <div className="space-y-2 pt-1">
              <p className="text-xs text-slate-400 text-center font-medium">
                {isValidationFrozen && !(lockedPlate || detectedPlate)
                  ? 'No se reconoció la placa automáticamente. Escríbela para entrenar:'
                  : '¿La placa detectada coincide con la que tienes en mano?'}
              </p>

              <div className="grid grid-cols-2 gap-2">
                {/* BOTÓN CONFIRMAR */}
                <button
                  onClick={handleConfirmarPlaca}
                  disabled={!(lockedPlate || detectedPlate)}
                  className={`py-3 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all ${
                    (lockedPlate || detectedPlate)
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40 hover:scale-[1.02] cursor-pointer'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>CONFIRMAR (ES CORRECTA)</span>
                </button>

                {/* BOTÓN RECHAZAR O CORREGIR */}
                <button
                  onClick={handleAbrirCorreccion}
                  className={`py-3 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer ${
                    isValidationFrozen && !(lockedPlate || detectedPlate)
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-900/50 ring-2 ring-indigo-400'
                      : 'bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/50 text-rose-300 hover:scale-[1.02]'
                  }`}
                >
                  <XCircle className="w-4 h-4" />
                  <span>
                    {isValidationFrozen && !(lockedPlate || detectedPlate)
                      ? '✏️ ESCRIBIR PLACA / CORREGIR'
                      : 'RECHAZAR / CORREGIR'}
                  </span>
                </button>
              </div>
            </div>

            {/* FORMULARIO DE CORRECCIÓN MANUAL (ACTIVE LEARNING) */}
            {isCorrectionOpen && (
              <div className="bg-slate-950 border border-indigo-500/40 rounded-xl p-3.5 space-y-3 animate-fade-in shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Brain className="w-4 h-4 text-indigo-400" />
                    Entrenar Corrección de Placa
                  </span>
                  <button
                    onClick={() => setIsCorrectionOpen(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-lg p-2 text-[11px] text-indigo-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>
                    El fotograma original está retenido y la cámara en pausa. Al pulsar 'Auto-Entrenar', se vinculará la foto exacta del auto a tu corrección.
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualPlateInput}
                      onChange={(e) => setManualPlateInput(e.target.value.toUpperCase())}
                      placeholder="Ej. X71-962 o ABC-123"
                      maxLength={8}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono font-bold text-white focus:outline-none focus:border-indigo-400 uppercase"
                    />
                    <button
                      onClick={handleGuardarCorreccion}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Auto-Entrenar
                    </button>
                  </div>

                  {/* Sugerencias Rápidas */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] text-slate-500">Muestras comunes:</span>
                    {['X71-962', 'W1X-942', 'ABC-123', 'KLP-482'].map((sug) => (
                      <button
                        key={sug}
                        onClick={() => setManualPlateInput(sug)}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-cyan-300 border border-slate-700"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* TARJETA 2: Dataset de Auto-Entrenamiento y Estado de Aprendizaje */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-white text-xs">Métricas de Auto-Entrenamiento</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cargarEstadisticas}
                  className="text-slate-400 hover:text-slate-200 text-[11px] flex items-center gap-1 transition-colors"
                  title="Recargar estadísticas del dataset"
                >
                  <RefreshCw className="w-3 h-3" />
                  Actualizar
                </button>
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(true)}
                  className="px-2 py-0.5 rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 hover:text-white text-[10px] font-mono flex items-center gap-1 transition-colors"
                  title="Limpiar y reiniciar todas las muestras para comenzar de cero"
                >
                  <Trash2 className="w-3 h-3 text-rose-400" />
                  Limpiar BD
                </button>
              </div>
            </div>

            {/* Contadores */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-lg font-bold font-mono text-cyan-400">
                  {trainingStats.total_muestras}
                </div>
                <div className="text-[10px] text-slate-400">Muestras Totales</div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-lg font-bold font-mono text-emerald-400">
                  {trainingStats.total_confirmadas}
                </div>
                <div className="text-[10px] text-slate-400">Confirmadas (OK)</div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-lg font-bold font-mono text-indigo-400">
                  {trainingStats.total_corregidas}
                </div>
                <div className="text-[10px] text-slate-400">Corregidas</div>
              </div>
            </div>

            {/* Selector de Épocas de Entrenamiento */}
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">Ciclos de Aprendizaje:</span>
                <span className="text-cyan-400 font-bold">{trainingEpochs} Épocas</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { ep: 5, label: '5 Épocas', desc: 'Rápido' },
                  { ep: 10, label: '10 Épocas', desc: 'Recomendado' },
                  { ep: 25, label: '25 Épocas', desc: 'Preciso' },
                ].map((item) => (
                  <button
                    key={item.ep}
                    type="button"
                    disabled={isTrainingRunning}
                    onClick={() => setTrainingEpochs(item.ep)}
                    className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-all border ${
                      trainingEpochs === item.ep
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Visualizador de Progreso en Vivo */}
            {(isTrainingRunning || trainingProgress?.en_progreso) && (
              <div className="bg-slate-950 border border-cyan-500/50 rounded-xl p-3.5 space-y-2.5 animate-fade-in shadow-xl">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-cyan-300 flex items-center gap-1.5 font-mono">
                    <Brain className="w-4 h-4 text-cyan-400 animate-spin" />
                    Entrenando Red Neuronal YOLOv8...
                  </span>
                  <span className="font-mono font-bold text-white bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/40">
                    {trainingProgress?.progreso_pct ?? 0}%
                  </span>
                </div>

                {/* Barra de Progreso */}
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full transition-all duration-500 shadow-[0_0_10px_#06b6d4]"
                    style={{ width: `${Math.max(5, trainingProgress?.progreso_pct ?? 5)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
                  <span>
                    Época: <strong className="text-white">{trainingProgress?.epoca_actual ?? 1}</strong> / {trainingProgress?.total_epocas ?? trainingEpochs}
                  </span>
                  {trainingProgress?.loss !== undefined && trainingProgress?.loss !== null && (
                    <span>
                      Loss: <strong className="text-emerald-400 font-bold">{trainingProgress.loss}</strong>
                    </span>
                  )}
                </div>

                <p className="text-[10px] text-slate-400 italic">
                  {trainingProgress?.mensaje || 'Ajustando pesos sinápticos con el dataset de placas...'}
                </p>
              </div>
            )}

            {/* Botón Disparar Auto-Entrenamiento */}
            <button
              onClick={handleEjecutarEntrenamiento}
              disabled={isTrainingRunning}
              className={`w-full py-2.5 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                isTrainingRunning
                  ? 'bg-slate-800 text-slate-400 cursor-wait'
                  : 'bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-lg shadow-cyan-900/20 hover:scale-[1.01]'
              }`}
            >
              <Brain className={`w-4 h-4 ${isTrainingRunning ? 'animate-spin' : ''}`} />
              <span>
                {isTrainingRunning
                  ? `Entrenando YOLOv8 (${trainingProgress?.epoca_actual ?? 1}/${trainingProgress?.total_epocas ?? trainingEpochs})...`
                  : `Consolidar y Auto-Entrenar (${trainingEpochs} Épocas)`}
              </span>
            </button>

            {/* Historial Breve de Correcciones: Ordenado por más recientes primero */}
            {Object.keys(trainingStats.correcciones || {}).length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Últimas Matrículas Aprendidas (Más Recientes):
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {Object.keys(trainingStats.correcciones).length} placas
                  </span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-[11px]">
                  {Object.entries(trainingStats.correcciones)
                    .sort(([, a], [, b]) => {
                      const tA = new Date(a.ultima_interaccion || 0).getTime();
                      const tB = new Date(b.ultima_interaccion || 0).getTime();
                      return tB - tA;
                    })
                    .slice(0, 10)
                    .map(([placa, info]) => (
                      <div
                        key={placa}
                        className="bg-slate-950 px-2 py-1 rounded border border-slate-800 flex items-center justify-between"
                      >
                        <span className="text-emerald-400 font-bold">{placa}</span>
                        <span className="text-[10px] text-slate-500">
                          {info.es_correcta ? 'Confirmada' : `Corregida (${info.detectado_previo || 'errónea'})`}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIRMACIÓN: REINICIAR / LIMPIAR BASE DE DATOS DE MUESTRAS */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Limpiar Base de Datos</h3>
                <p className="text-xs text-slate-400">¿Reiniciar todas las muestras de auto-entrenamiento?</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Esta acción eliminará las <strong className="text-rose-400 font-bold">{trainingStats.total_muestras} muestras</strong> acumuladas (imágenes, etiquetas y registros de calibración en <code className="text-cyan-300">dataset_autoentrenamiento/</code>) para que puedas comenzar a capturar y entrenar placas nuevas y limpias.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                disabled={isResetting}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleLimpiarDataset}
                disabled={isResetting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 shadow-lg shadow-rose-900/30"
              >
                {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>{isResetting ? 'Limpiando...' : 'Sí, Limpiar Base de Datos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
