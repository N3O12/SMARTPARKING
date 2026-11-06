import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();

  // Increase payload limit for Base64 camera frames and uploaded high-res photos
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // Endpoint Vision ALPR con Gemini 3.8 Flash:
  // Reconoce placas borrosas (por lejanía, cercanía o desenfoque) y placas escritas a mano en cuadernos/papel
  app.post('/api/gemini-ocr', async (req, res) => {
    const tStart = Date.now();
    try {
      const { image_base64 } = req.body || {};
      if (!image_base64 || typeof image_base64 !== 'string') {
        res.status(400).json({ error: 'Se requiere image_base64' });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        res.status(503).json({
          exito: false,
          placa: '',
          confianza: 0,
          metodo: 'Gemini API Key no disponible',
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      let mimeType = 'image/jpeg';
      let base64Data = image_base64;
      if (image_base64.includes(',')) {
        const parts = image_base64.split(',');
        const header = parts[0];
        base64Data = parts[1];
        const mimeMatch = header.match(/data:(image\/[a-zA-Z0-9+.-]+);base64/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: `Eres un motor ALPR (Reconocimiento Automático de Matrículas) de alta precisión para Perú.
Analiza la imagen y determina PRIMERO si realmente existe una placa vehicular o un código de matrícula de 6 caracteres escrito intencionalmente (formato XXX-XXX o XX-XXXX, como W2U-792, 206-37F, ABC-123, X71-962, A1B-234).
REGLAS CRÍTICAS ANTI-FALSOS POSITIVOS:
1. Si en la imagen NO hay ninguna placa vehicular ni ningún código de matrícula escrito (por ejemplo: si solo se ve una habitación vacía, pared, techo, persona/rostro, muebles, escritorio, teclado, hoja de cuaderno en blanco sin texto, o texto común que NO es una placa de 6 caracteres), DEBES devolver obligatoriamente placa: "", texto_crudo: "", confianza: 0, escenario: "Sin Placa", bbox_2d: []. ¡JAMÁS inventes ni adivines una placa donde no la hay!
2. Si SÍ hay una placa vehicular real (incluso si está borrosa por lejanía, cercanía o desenfoque de cámara) o una matrícula de 6 caracteres escrita a mano en un cuaderno/papel (con al menos 1 letra y al menos 2 números, ej. "206-37F"), lee los 6 caracteres con exactitud y devuelve en bbox_2d las coordenadas [ymin, xmin, ymax, xmax] de 0 a 1000 que encierran únicamente la placa o matrícula escrita.`,
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              placa: {
                type: Type.STRING,
                description:
                  'Matrícula detectada normalizada con guión (ej. W2U-792, 206-37F, ABC-123) o cadena vacía "" si no hay ninguna placa real.',
              },
              texto_crudo: {
                type: Type.STRING,
                description: 'Texto exacto leído en la placa o cadena vacía "" si no hay placa.',
              },
              confianza: {
                type: Type.NUMBER,
                description: 'Nivel de confianza entre 0.0 y 1.0 (0.0 si no hay placa).',
              },
              escenario: {
                type: Type.STRING,
                description:
                  'Tipo de detección: Cuaderno/Manuscrito, Vehículo Borroso/Lejano, Vehículo Nítido, Pantalla, o Sin Placa.',
              },
              bbox_2d: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description:
                  'Caja delimitadora [ymin, xmin, ymax, xmax] en escala 0 a 1000 encerrando exactamente la placa, o [] si no hay placa.',
              },
            },
            required: ['placa', 'texto_crudo', 'confianza', 'escenario', 'bbox_2d'],
          },
        },
      });

      const rawText = response.text || '{}';
      const parsed = JSON.parse(rawText);
      const latenciaMs = Date.now() - tStart;
      const confVal = typeof parsed.confianza === 'number' ? parsed.confianza : 0;
      const placaClean = (parsed.placa || '').trim().toUpperCase();
      const tienePlacaValida =
        placaClean.length >= 6 &&
        confVal >= 0.78 &&
        parsed.escenario !== 'Sin Placa';

      res.json({
        exito: tienePlacaValida,
        placa: tienePlacaValida ? placaClean : '',
        texto_crudo: tienePlacaValida ? parsed.texto_crudo || placaClean : '',
        confianza: tienePlacaValida ? confVal : 0,
        escenario: parsed.escenario || 'Sin Placa',
        bbox_2d: tienePlacaValida && Array.isArray(parsed.bbox_2d) ? parsed.bbox_2d : null,
        metodo: `Gemini Vision ALPR (${parsed.escenario || 'Multi-Escenario'}, ${latenciaMs}ms)`,
        latencia_ms: latenciaMs,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[Gemini ALPR] Aviso en inferencia:', msg);
      res.status(200).json({
        exito: false,
        placa: '',
        confianza: 0,
        metodo: 'Fallback Local OCR',
        error: msg,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SGE Pro Server + Gemini Vision ALPR activo en http://0.0.0.0:${PORT}`);
  });
}

startServer();
