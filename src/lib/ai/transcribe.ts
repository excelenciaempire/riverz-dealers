/**
 * Transcripción de audios y voice notes vía Whisper.
 *
 * Soporta dos proveedores (ambos OpenAI-compatible):
 *   - Groq (whisper-large-v3) — preferido: gratis + más rápido.
 *   - OpenAI (whisper-1) — fallback.
 *
 * Usado por el runner cuando recibe un `messages.media_type` =
 * 'voice' | 'audio' y todavía no hay `media_transcription` cacheada.
 * El runner cachea el resultado en la columna para no re-transcribir
 * en cada turno del agente.
 *
 * Si ninguna API key está configurada, devolvemos null y el caller
 * decide qué decirle a Claude (típicamente "el cliente mandó un audio
 * que no pude entender"). Esto evita un fail duro en workspaces que
 * todavía no quieren pagar transcripción.
 */

const GROQ_ENDPOINT =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";

type Provider = {
  name: "groq" | "openai";
  endpoint: string;
  model: string;
  apiKey: string;
};

export interface TranscriptionResult {
  text: string;
  language?: string;
}

function pickProvider(): Provider | null {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      name: "groq",
      endpoint: GROQ_ENDPOINT,
      model: "whisper-large-v3",
      apiKey: groqKey,
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: "openai",
      endpoint: OPENAI_ENDPOINT,
      model: "whisper-1",
      apiKey: openaiKey,
    };
  }
  return null;
}

/**
 * Baja el audio desde la URL pública y lo manda al provider activo.
 * Devuelve el texto plano transcripto o null si:
 *   - no hay GROQ_API_KEY ni OPENAI_API_KEY,
 *   - la URL no es accesible,
 *   - el endpoint del provider devuelve error.
 *
 * Nunca tira excepción — el runner no debería frenarse porque un
 * audio se rompió.
 */
export async function transcribeAudio(
  audioUrl: string,
): Promise<TranscriptionResult | null> {
  const provider = pickProvider();
  if (!provider) {
    console.warn(
      "[transcribe] ni GROQ_API_KEY ni OPENAI_API_KEY configuradas — saltando transcripción.",
    );
    return null;
  }
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      console.warn(
        `[transcribe] no se pudo bajar el audio (${audioRes.status}): ${audioUrl}`,
      );
      return null;
    }
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    // Inferimos un filename con extensión para que Whisper detecte el
    // codec. La mayoría de los voice notes WhatsApp son ogg/opus —
    // Whisper acepta ogg directamente.
    const mime =
      audioRes.headers.get("content-type") || "audio/ogg";
    const ext = mimeToWhisperExt(mime);
    const filename = `voice.${ext}`;

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      filename,
    );
    form.append("model", provider.model);
    // Forzamos español: el voice note típico en este producto es
    // cliente colombiano / hispanohablante. Whisper igual tolera mezcla,
    // y esto le da al modelo un prior más fuerte para no confundir
    // codeswitch con inglés.
    form.append("language", "es");

    const res = await fetch(provider.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(
        `[transcribe] ${provider.name} respondió ${res.status}: ${detail.slice(0, 200)}`,
      );
      return null;
    }
    const json = (await res.json()) as { text?: string; language?: string };
    const text = (json.text ?? "").trim();
    if (!text) return null;
    return { text, language: json.language };
  } catch (err) {
    console.warn("[transcribe] excepción:", err);
    return null;
  }
}

function mimeToWhisperExt(mime: string): string {
  const lower = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/amr": "amr",
  };
  return map[lower] ?? "ogg";
}
