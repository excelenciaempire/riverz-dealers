/**
 * Rescatar una llamada que el worker nunca alcanzó a reportar.
 *
 * El audio y la transcripción viajan por caminos distintos, y sólo uno de los
 * dos sobrevive a que el worker se muera:
 *
 * - La **grabación** la sube LiveKit Egress directo a Storage, sin pasar por el
 *   worker. Siempre llega, con clave determinista `<call_id>.ogg`.
 * - La **transcripción** la junta el worker en memoria y la manda toda junta al
 *   final, en `POST /internal/voice/result`. Si el proceso muere antes —un
 *   deploy que le reemplaza el contenedor, un OOM, un corte— se pierde entera.
 *
 * Eso deja llamadas con audio y sin una palabra escrita, invisibles en la
 * bandeja. Pasó el 2026-08-28: una llamada de 83 segundos con una venta
 * completa adentro quedó en `dialing`, sin transcripción y sin grabación
 * enlazada, mientras el .ogg estaba en Storage todo el tiempo.
 *
 * Acá se reconstruye lo que falta a partir del audio, que es lo único que
 * quedó. No reemplaza al camino normal: es la red para cuando ese camino se
 * corta.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceTranscriptTurn } from './result';

const BUCKET = 'voice-recordings';

/** La clave del audio de una llamada. Determinista: la fija el egress. */
export function recordingKey(callId: string): string {
  return `${callId}.ogg`;
}

/** ¿Está el audio de esta llamada en Storage? */
export async function recordingExists(
  db: SupabaseClient,
  callId: string,
): Promise<boolean> {
  const { data } = await db.storage
    .from(BUCKET)
    .list('', { search: recordingKey(callId), limit: 1 });
  return (data ?? []).some((o) => o.name === recordingKey(callId));
}

/**
 * Transcribe el audio con Deepgram y devuelve los turnos.
 *
 * `diarize` separa hablantes, pero la grabación es una mezcla de los dos lados
 * y Deepgram no sabe cuál es el agente: los números de hablante son
 * arbitrarios. Se decide por ORDEN — en una saliente habla primero el agente,
 * en una entrante el cliente— y a partir de ahí se alterna por cambio de
 * hablante. No es perfecto, y por eso los turnos rescatados se marcan como
 * tales: es mejor una transcripción aproximada que ninguna.
 */
export async function transcribeRecording(
  db: SupabaseClient,
  callId: string,
  opts: { language?: string; direction?: string } = {},
): Promise<VoiceTranscriptTurn[] | null> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;

  const { data: blob, error } = await db.storage.from(BUCKET).download(recordingKey(callId));
  if (error || !blob) return null;

  const qs = new URLSearchParams({
    model: 'nova-3',
    language: opts.language || 'es',
    diarize: 'true',
    punctuate: 'true',
    utterances: 'true',
    smart_format: 'true',
  });

  let json: {
    results?: { utterances?: { speaker?: number; transcript?: string; start?: number }[] };
  };
  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/ogg' },
      body: await blob.arrayBuffer(),
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }

  const utts = json.results?.utterances ?? [];
  if (utts.length === 0) return null;

  // Quién habla primero: en una saliente, el agente (dice el saludo).
  const primero = opts.direction === 'inbound' ? 'customer' : 'agent';
  const otro = primero === 'agent' ? 'customer' : 'agent';
  const primerHablante = utts[0].speaker;

  return utts
    .filter((u) => (u.transcript ?? '').trim() !== '')
    .map((u) => ({
      role: u.speaker === primerHablante ? primero : otro,
      text: (u.transcript ?? '').trim(),
    })) as VoiceTranscriptTurn[];
}
