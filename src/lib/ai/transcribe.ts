import type { BillingContext } from '@/lib/wallet/operacion';
import { cancelar, liquidar, reservar } from '@/lib/wallet/operacion';
import { parseBuffer } from 'music-metadata';
import { observePlatformCredit } from '@/lib/admin/provider-credit';
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

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

type Provider = {
  name: 'groq' | 'openai';
  endpoint: string;
  model: string;
  apiKey: string;
};

/** ¿Hay con qué transcribir? Sin esto, quien encola trabajo no puede
 *  distinguir "no se entendió nada" de "no hay clave configurada" — y marcaría
 *  como mudo un video que nadie llegó a escuchar. */
export function transcripcionDisponible(): boolean {
  return pickProvider() !== null;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  /** Cuánto duraba el audio. Es lo que cobra Whisper, así que sin esto no se
   *  le puede pasar el costo al comercio. */
  segundos?: number;
  /** Qué proveedor lo hizo: cobran distinto. */
  proveedor?: 'groq' | 'openai';
}

/**
 * Lo que cobra cada proveedor por minuto de audio.
 *
 * Groq (whisper-large-v3): 0,111 USD la hora. OpenAI (whisper-1): 0,006 USD el
 * minuto. Son los precios de lista, que es lo que se le pasa al comercio.
 */
export const USD_POR_MINUTO: Record<'groq' | 'openai', number> = {
  groq: 0.111 / 60,
  openai: 0.006,
};

function pickProvider(): Provider | null {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      name: 'groq',
      endpoint: GROQ_ENDPOINT,
      model: 'whisper-large-v3',
      apiKey: groqKey,
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: 'openai',
      endpoint: OPENAI_ENDPOINT,
      model: 'whisper-1',
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
  billing: BillingContext
): Promise<TranscriptionResult | null> {
  const provider = pickProvider();
  if (!provider) {
    console.warn(
      '[transcribe] ni GROQ_API_KEY ni OPENAI_API_KEY configuradas — saltando transcripción.'
    );
    return null;
  }
  try {
    const audioRes = await fetch(audioUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!audioRes.ok) {
      console.warn(
        `[transcribe] no se pudo bajar el audio (${audioRes.status}): ${audioUrl}`
      );
      return null;
    }
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    // Inferimos un filename con extensión para que Whisper detecte el
    // codec. La mayoría de los voice notes WhatsApp son ogg/opus —
    // Whisper acepta ogg directamente.
    const mime = audioRes.headers.get('content-type') || 'audio/ogg';
    return await transcribeBuffer(buffer, {
      billing,
      mime,
      filename: `voice.${mimeToWhisperExt(mime)}`,
    });
  } catch (err) {
    console.warn('[transcribe] excepción:', err);
    return null;
  }
}

/**
 * Lo mismo, pero con los bytes ya en la mano.
 *
 * Existe porque no todo lo que hay que transcribir se puede bajar con un
 * `fetch` pelado: el video de TikTok necesita cabeceras de navegador y la
 * cookie que devuelve su propia página, así que quien lo baja es el módulo
 * que sabe hacerlo y acá sólo llega el archivo.
 *
 * Whisper acepta contenedores de video (mp4/webm): se queda con la pista de
 * audio. No hace falta desmuxar nada.
 */
export async function transcribeBuffer(
  buffer: Buffer,
  opts: {
    billing: BillingContext;
    mime?: string;
    filename?: string;
    timeoutMs?: number;
    /** Inbox requests can detect language; existing callers keep their Spanish prior. */
    detectLanguage?: boolean;
  }
): Promise<TranscriptionResult | null> {
  const provider = pickProvider();
  if (!provider) {
    console.warn(
      '[transcribe] ni GROQ_API_KEY ni OPENAI_API_KEY configuradas — saltando transcripción.'
    );
    return null;
  }
  const mime = opts.mime || 'audio/ogg';
  const filename = opts.filename || `audio.${mimeToWhisperExt(mime)}`;
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mime }),
      filename
    );
    form.append('model', provider.model);
    // Forzamos español: el voice note típico en este producto es
    // cliente colombiano / hispanohablante. Whisper igual tolera mezcla,
    // y esto le da al modelo un prior más fuerte para no confundir
    // codeswitch con inglés.
    if (!opts.detectLanguage) form.append('language', 'es');
    // Con esto la respuesta trae `duration`, que es lo que cobra Whisper.
    // Sin el número no hay forma de pasarle el costo al comercio.
    form.append('response_format', 'verbose_json');

    // Reserve a bounded audio budget; files over the provider limit never leave Riverz.
    if (buffer.length > 25 * 1024 * 1024) throw new Error('audio_too_large');
    const metadata = await parseBuffer(
      buffer,
      { mimeType: mime },
      { duration: true }
    );
    const duration = metadata.format.duration;
    if (!duration || !Number.isFinite(duration) || duration > 3600)
      throw new Error('wallet_audio_duration_unavailable');
    const id = await reservar(
      opts.billing,
      provider.name,
      (Math.max(10, Math.ceil(duration)) / 60) * USD_POR_MINUTO[provider.name],
      { modelo: provider.model }
    );
    const res = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: form,
      // Un voice note son segundos; un video de un minuto tarda más de 10.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    });
    await observePlatformCredit(opts.billing.db, provider.name, provider.apiKey, res);
    if (!res.ok) {
      if ([400, 401, 403, 413, 422, 429].includes(res.status))
        await cancelar(opts.billing, id);
      const detail = await res.text().catch(() => '');
      console.warn(
        `[transcribe] ${provider.name} respondió ${res.status}: ${detail.slice(0, 200)}`
      );
      return null;
    }
    const json = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };
    if (!Number.isFinite(json.duration) || json.duration! < 0)
      throw new Error('wallet_missing_duration');
    const seconds =
      provider.name === 'groq'
        ? Math.max(10, json.duration!)
        : Math.ceil(json.duration!);
    await liquidar(
      opts.billing,
      id,
      provider.name,
      (seconds / 60) * USD_POR_MINUTO[provider.name],
      { modelo: provider.model, segundos: json.duration }
    );
    const text = (json.text ?? '').trim();
    if (!text) return null;
    return {
      text,
      language: json.language,
      segundos: typeof json.duration === 'number' ? json.duration : undefined,
      proveedor: provider.name,
    };
  } catch (err) {
    console.warn('[transcribe] excepción:', err);
    return null;
  }
}

function mimeToWhisperExt(mime: string): string {
  const lower = mime.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/amr': 'amr',
  };
  return map[lower] ?? 'ogg';
}
