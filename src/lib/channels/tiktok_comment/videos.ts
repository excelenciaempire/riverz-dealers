import { transcribeBuffer, transcripcionDisponible } from '@/lib/ai/transcribe';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import type { ChannelConnection } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * QUÉ DICE EL VIDEO.
 *
 * Un comentario de TikTok no contesta una conversación: contesta un video.
 * El agente veía el comentario suelto y contestaba a ciegas — ante "eso
 * también es cuando se expone mucho al sol" el borrador salía diciendo "me
 * falta contexto de la conversación anterior", que es justo lo que un cliente
 * no tiene que leer.
 *
 * El guion del video trae casi todas las respuestas: el precio, la promoción,
 * los ingredientes, la promesa, el "hacé clic y obtené envío gratis". Con la
 * transcripción arriba, contestar un comentario deja de ser adivinar.
 *
 * Cómo se consigue el audio: la API de negocios de TikTok da el `share_url`
 * pero NO el archivo. La página pública del video sí trae la dirección de
 * reproducción, y esa dirección exige cabeceras de navegador y la cookie que
 * la propia página devuelve. Es frágil a propósito de TikTok, así que todo
 * este módulo falla blando: si un video no se puede bajar, queda en `error`,
 * se reintenta unas veces y el resto del sistema sigue igual que antes —
 * con el caption y nada más.
 *
 * Se transcribe UNA vez por video. Un video con 400 comentarios se transcribe
 * una vez, no 400.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
/** Techo del archivo. Whisper de Groq corta en 25 MB y un TikTok de un minuto
 *  pesa ~4 MB: lo que pase de acá es otra cosa y no vale la pena bajarlo. */
const MAX_BYTES = 24 * 1024 * 1024;
/** TikTok contesta primero con una página señuelo de ~13 KB —su defensa
 *  anti-bots— y recién al tercer o cuarto pedido entrega la de verdad, de
 *  ~395 KB. Medido sobre los dos videos que fallaban: intento 0 y 1 señuelo,
 *  intento 2 la buena, siempre. */
const INTENTOS_DESCARGA = 5;
/** Y hay que darle aire entre pedido y pedido: tres intentos en el mismo
 *  instante recibían tres veces el señuelo. */
const ESPERA_ENTRE_PEDIDOS_MS = 1500;
/** Cuántas veces se reintenta un video que falla. Después se abandona: la
 *  cuota no se quema en el mismo archivo roto cada quince minutos. */
const MAX_INTENTOS = 6;
/** Y entre intento e intento se espera: cuando TikTok niega la descarga suele
 *  ser por un rato, no para siempre. Sin esta espera los seis intentos se
 *  gastaban en el mismo minuto malo. */
const ESPERA_ENTRE_INTENTOS_MS = 30 * 60 * 1000;
/** Un video de un minuto tarda ~12 s en transcribirse. */
const TIMEOUT_TRANSCRIPCION_MS = 120_000;

export interface VideoTikTok {
  video_id: string;
  caption: string | null;
  share_url: string | null;
  posted_at: string | null;
}

/**
 * Guarda (o actualiza) los videos que devolvió la API. Sólo metadatos: la
 * transcripción la hace después el cron, y NUNCA se pisa lo ya transcripto.
 */
export async function guardarVideos(
  db: SupabaseClient,
  conn: ChannelConnection,
  videos: Array<Record<string, unknown>>
): Promise<number> {
  const filas = videos
    .map((v) => {
      const videoId = String(v.item_id ?? v.video_id ?? '');
      if (!videoId) return null;
      const creado = Number(v.create_time ?? 0);
      return {
        workspace_id: conn.workspace_id,
        connection_id: conn.id,
        video_id: videoId,
        caption: v.caption ? String(v.caption).slice(0, 2000) : null,
        share_url: v.share_url ? String(v.share_url) : null,
        posted_at: creado ? new Date(creado * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  if (filas.length === 0) return 0;

  // `ignoreDuplicates: false` actualiza caption y share_url —el comercio puede
  // editar el texto del video— pero el upsert NO toca las columnas de
  // transcripción, que no viajan en la fila.
  const { error } = await db.from('tiktok_videos').upsert(filas, {
    onConflict: 'workspace_id,video_id',
    ignoreDuplicates: false,
  });
  if (error) {
    console.warn('[tiktok/videos] no se pudieron guardar:', error.message);
    return 0;
  }
  return filas.length;
}

/**
 * Transcribe los videos que faltan, del más nuevo al más viejo. Devuelve
 * cuántos quedaron con texto.
 *
 * Se llama desde el cron de comentarios con un tope chico por corrida: cada
 * video son unos segundos de descarga y ~12 s de Whisper, y lo que importa es
 * que el video de hoy —el que está juntando comentarios— esté transcripto
 * pronto, no vaciar la cola de una sentada.
 */
export async function transcribirPendientes(
  db: SupabaseClient,
  opts: { limite?: number } = {}
): Promise<{ intentados: number; transcriptos: number }> {
  // Sin clave de transcripción no se toca nada: los videos quedan pendientes
  // y se transcriben el día que la clave exista. Marcarlos "sin audio" acá
  // sería mentir sobre un video que nadie escuchó.
  if (!transcripcionDisponible()) return { intentados: 0, transcriptos: 0 };

  const limite = Math.max(1, opts.limite ?? 2);
  // Los que nunca se intentaron entran siempre; los que fallaron, sólo si ya
  // pasó la espera.
  const listo = new Date(Date.now() - ESPERA_ENTRE_INTENTOS_MS).toISOString();
  const { data } = await db
    .from('tiktok_videos')
    .select('id, video_id, share_url, transcript_attempts, workspace_id')
    .or(
      `transcript_status.eq.pending,and(transcript_status.eq.error,updated_at.lt.${listo})`
    )
    .lt('transcript_attempts', MAX_INTENTOS)
    .not('share_url', 'is', null)
    .order('posted_at', { ascending: false, nullsFirst: false })
    // De más: los de cuentas que no pueden usar la IA se saltean abajo, y no
    // pueden tapar la cola de las demás.
    .limit(limite * 5);
  const candidatos = (data ?? []) as Array<{
    id: string;
    video_id: string;
    share_url: string;
    transcript_attempts: number;
    /** De quién es el video: sin esto no se sabe a quién cobrarle el minuto. */
    workspace_id: string | null;
  }>;
  // Transcribir se cobra. El video de la cuenta sin IA —sin pagar o sin
  // saldo— queda pendiente y se transcribe cuando pueda.
  const puede = new Map<string, boolean>();
  const pendientes: typeof candidatos = [];
  for (const v of candidatos) {
    if (pendientes.length >= limite) break;
    if (!v.workspace_id) continue;
    if (!puede.has(v.workspace_id)) puede.set(v.workspace_id, await puedeUsarIa(db, v.workspace_id));
    if (puede.get(v.workspace_id)) pendientes.push(v);
  }

  let transcriptos = 0;
  for (const v of pendientes) {
    const intento = (v.transcript_attempts ?? 0) + 1;
    try {
      const descarga = await bajarVideo(v.share_url);
      if (descarga.tipo === 'sin_video') {
        // Publicación de FOTOS: un carrusel con música, sin video. No hay nada
        // que transcribir y no tiene sentido reintentarlo cada quince minutos.
        await db
          .from('tiktok_videos')
          .update({
            transcript_status: 'sin_audio',
            transcript_error: 'publicación de fotos, sin video',
            transcript_attempts: intento,
            transcribed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', v.id);
        continue;
      }
      if (descarga.tipo !== 'ok') {
        await marcarError(db, v.id, intento, 'no se pudo bajar el video');
        continue;
      }
      const r = await transcribeBuffer(descarga.archivo, {
        billing: {
          db,
          workspaceId: v.workspace_id ?? '',
          concepto: 'transcripcion',
        },
        mime: 'video/mp4',
        filename: `${v.video_id}.mp4`,
        timeoutMs: TIMEOUT_TRANSCRIPCION_MS,
      });
      if (!r?.text) {
        // Sin texto puede ser un video sin voz (música y placas) — eso no es
        // un fallo y no se reintenta eternamente.
        await db
          .from('tiktok_videos')
          .update({
            transcript_status: 'sin_audio',
            transcript_attempts: intento,
            transcribed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', v.id);
        continue;
      }
      await db
        .from('tiktok_videos')
        .update({
          transcript: r.text.slice(0, 20000),
          transcript_status: 'ok',
          transcript_error: null,
          transcript_attempts: intento,
          transcribed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', v.id);
      transcriptos++;
    } catch (err) {
      await marcarError(
        db,
        v.id,
        intento,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return { intentados: pendientes.length, transcriptos };
}

async function marcarError(
  db: SupabaseClient,
  id: string,
  intento: number,
  motivo: string
): Promise<void> {
  await db
    .from('tiktok_videos')
    .update({
      transcript_status: 'error',
      transcript_error: motivo.slice(0, 500),
      transcript_attempts: intento,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Baja el archivo del video desde su página pública.
 *
 * La dirección de reproducción vive dentro del HTML y sólo sirve con la
 * cookie que esa misma respuesta entrega. TikTok devuelve a veces una página
 * sin ella —defensa anti-bots—, así que se reintenta; si igual no aparece,
 * devuelve null y el llamador lo anota como error reintentable.
 */
type Descarga =
  | { tipo: 'ok'; archivo: Buffer }
  /** La publicación no tiene video: es un carrusel de fotos. */
  | { tipo: 'sin_video' }
  | { tipo: 'fallo' };

async function bajarVideo(shareUrl: string): Promise<Descarga> {
  for (let intento = 0; intento < INTENTOS_DESCARGA; intento++) {
    if (intento > 0) {
      await new Promise((r) =>
        setTimeout(r, ESPERA_ENTRE_PEDIDOS_MS * intento)
      );
    }
    try {
      const pagina = await fetch(shareUrl, {
        headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!pagina.ok) continue;
      const html = await pagina.text();
      const m = /"playAddr":"(.*?)"/.exec(html);
      if (!m) continue;
      // La página buena existe y la dirección viene VACÍA: es una publicación
      // de fotos. Distinto de "TikTok no me dio la página", que sí conviene
      // reintentar. Sin esta distinción los carruseles se reintentaban seis
      // veces y quedaban marcados como error para siempre.
      if (!m[1]) return { tipo: 'sin_video' };
      let directa: string;
      try {
        // Viene con los "/" escapados como /: JSON.parse lo deshace sin
        // inventar un reemplazo a mano.
        directa = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        continue;
      }
      if (!directa.startsWith('https://')) return { tipo: 'sin_video' };
      const cookies = (pagina.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .join('; ');

      const archivo = await fetch(directa, {
        headers: {
          'user-agent': UA,
          referer: 'https://www.tiktok.com/',
          ...(cookies ? { cookie: cookies } : {}),
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!archivo.ok) continue;
      const largo = Number(archivo.headers.get('content-length') ?? 0);
      if (largo > MAX_BYTES) return { tipo: 'fallo' };
      const buf = Buffer.from(await archivo.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) return { tipo: 'fallo' };
      return { tipo: 'ok', archivo: buf };
    } catch {
      /* siguiente intento */
    }
  }
  return { tipo: 'fallo' };
}

/**
 * El bloque que se le pasa al modelo cuando contesta un comentario de este
 * video. Devuelve null si no se sabe nada del video (y entonces el prompt
 * queda como estaba).
 */
export async function briefDeVideo(
  db: SupabaseClient,
  workspaceId: string,
  videoId: string
): Promise<string | null> {
  const { data } = await db
    .from('tiktok_videos')
    .select('caption, transcript, transcript_status')
    .eq('workspace_id', workspaceId)
    .eq('video_id', videoId)
    .maybeSingle();
  const v = data as {
    caption: string | null;
    transcript: string | null;
    transcript_status: string;
  } | null;
  if (!v) return null;

  const lineas = [
    '## El video que están comentando',
    'Este comentario está debajo de un video de TikTok de la tienda. La persona le habla al VIDEO, no a una conversación previa: si su comentario parece suelto, es porque se entiende leyendo lo de abajo.',
  ];
  if (v.caption?.trim()) lineas.push(`Texto del video: ${v.caption.trim()}`);
  if (v.transcript?.trim()) {
    lineas.push(
      `Lo que se dice en el video: "${v.transcript.trim().slice(0, 4000)}"`
    );
    lineas.push(
      'El video sirve para ENTENDER de qué está hablando la persona, no como fuente de datos. Los ingredientes, los precios, las promociones y los envíos salen de la ficha del producto: si el video dice algo distinto, manda la ficha y no repitas lo del video.'
    );
  }
  // Sólo el caption no alcanza para nada más que ubicar el tema; se dice para
  // que el modelo no invente lo que el video "seguro decía".
  if (!v.transcript?.trim()) {
    lineas.push(
      'No hay transcripción del audio: no supongas qué se dijo en el video más allá de su texto.'
    );
  }
  return lineas.join('\n');
}

/**
 * Igual, pero partiendo del hilo: el runner conoce la conversación, no el
 * video. Una consulta más, sólo en el canal de comentarios de TikTok.
 */
export async function briefDeVideoPorConversacion(
  db: SupabaseClient,
  workspaceId: string,
  conversationId: string
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('thread_external_id')
    .eq('id', conversationId)
    .maybeSingle();
  const videoId = videoDelHilo(
    (data as { thread_external_id?: string | null } | null)?.thread_external_id
  );
  return videoId ? briefDeVideo(db, workspaceId, videoId) : null;
}

/** El id del video que hay dentro de "video:<id>|comment:<id>". */
export function videoDelHilo(
  threadExternalId: string | null | undefined
): string | null {
  const t = String(threadExternalId ?? '');
  if (!t.startsWith('video:')) return null;
  const id = t.slice(6).split('|')[0];
  return id || null;
}
