/**
 * Transcripción de audios y voice notes vía OpenAI Whisper.
 *
 * Usado por el runner cuando recibe un `messages.media_type` =
 * 'voice' | 'audio' y todavía no hay `media_transcription` cacheada.
 * El runner cachea el resultado en la columna para no re-transcribir
 * en cada turno del agente.
 *
 * Si `OPENAI_API_KEY` no está configurada, devolvemos null y el caller
 * decide qué decirle a Claude (típicamente "el cliente mandó un audio
 * que no pude entender"). Esto evita un fail duro en workspaces que
 * todavía no quieren pagar la API de OpenAI.
 *
 * Endpoint: POST https://api.openai.com/v1/audio/transcriptions
 * Modelo: whisper-1 (default, multilenguaje).
 */

const TRANSCRIPTION_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";

export interface TranscriptionResult {
  text: string;
  language?: string;
}

/**
 * Baja el audio desde la URL pública y lo manda a Whisper. Devuelve
 * el texto plano transcripto o null si:
 *   - falta OPENAI_API_KEY,
 *   - la URL no es accesible,
 *   - el endpoint de OpenAI devuelve error.
 *
 * Nunca tira excepción — el runner no debería frenarse porque un
 * audio se rompió.
 */
export async function transcribeAudio(
  audioUrl: string,
): Promise<TranscriptionResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[transcribe] OPENAI_API_KEY no configurada — saltando transcripción.",
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
    form.append("model", "whisper-1");
    // No forzamos idioma — el voice note puede ser español, inglés o
    // mezclado. Whisper detecta solo y eso nos da más cobertura.

    const res = await fetch(TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(
        `[transcribe] OpenAI respondió ${res.status}: ${detail.slice(0, 200)}`,
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
