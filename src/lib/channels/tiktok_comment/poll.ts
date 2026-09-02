import { supabaseAdmin } from '../admin-client';
import { ingestInboundEvent } from '../inbox-writer';
import { listConnections } from '../connections';
import {
  applyCommentLifecycle,
  patchFor,
  type CommentRow,
} from '../comment-sync';
import { guardarVideos } from './videos';
import { getFreshTikTokToken } from './adapter';
import type { ChannelConnection } from '@/types';

const TT = 'https://business-api.tiktok.com/open_api/v1.3';
const VIDEOS_PER_RUN = 10; // rate-limit friendly: newest videos carry ~all fresh comments
/** Videos viejos pero con comentarios recientes que se agregan a cada corrida
 *  liviana. Tope bajo a propósito: cada uno es una llamada más a TikTok. */
const ACTIVE_VIDEOS_PER_RUN = 8;
/** Qué tan atrás cuenta como "sigue vivo" para incluir un video viejo. */
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Un comentario tiene que faltar en DOS lecturas separadas para darlo por
 *  borrado. El barrido profundo corre cada 6 h, así que con una hora alcanza
 *  para exigir corridas distintas y no dos vueltas del mismo bucle. */
const MISSING_GRACE_MS = 60 * 60 * 1000;
const VIDEOS_PER_PAGE = 20; // barrido profundo: máximo que acepta video/list
const MAX_VIDEO_PAGES = 15; // techo de seguridad (~300 videos por cuenta)
const COMMENTS_PER_VIDEO = 30; // TikTok cap: comment/list max_count must be <= 30
const MAX_COMMENT_PAGES = 20; // hasta 600 comentarios por video
/**
 * HASTA CUÁNDO SE CONTESTA SOLO UN COMENTARIO.
 *
 * Eran 2 horas y castigaba al cliente por una demora nuestra. El sondeo de 5
 * minutos mira los 10 videos más nuevos más 8 con actividad; un comentario en
 * cualquier otro video aparece recién en el barrido profundo, 6 horas después.
 * Para entonces ya pasó de las 2 horas y quedaba descartado para siempre, en
 * silencio.
 *
 * Medido el 2026-08-28 en la cuenta piloto: 63 comentarios de clientes en 7
 * días y 2 corridas del agente en 14. Entre lo que nadie contestó estaban
 * "yo lo quiero como lo consigo?" y "Lo quiero", cuatro días parados.
 *
 * 48 horas: alguien que escribió "lo quiero" ayer sigue queriéndolo, y
 * contestarle tarde es infinitamente mejor que no contestarle. Lo que esta
 * ventana sigue frenando es el rescate de verdad — ver por primera vez un
 * video con años de comentarios encima, que es el caso de `VIDEO_NUEVO`.
 */
const VENTANA_RESPUESTA_MS = 48 * 60 * 60 * 1000;
/** Centinela ya conocido por la bandeja para "la plataforma no entrega esto":
 *  la burbuja lo muestra traducido (isUnsupportedSnippet). */
const UNSUPPORTED_TEXT = '[unsupported]';

/**
 * Polling ingest for TikTok comments (Accounts API has webhooks, but they
 * need per-app portal configuration post-approval — until then this cron IS
 * the inbound path, and afterwards it stays as the reconciliation backstop,
 * same pattern as Gmail/Outlook). Idempotent on externalMessageId
 * (comment_id). Also keeps tokens fresh as a side effect of every run —
 * the 24h access token would otherwise die between quiet days.
 * Wired via cron-tiktok-comments.
 *
 * Dos ritmos:
 *  - normal (cada 5 min): sólo los 10 videos más nuevos. Es el ritmo al que
 *    TikTok entrega de verdad; preguntar más seguido no adelanta nada.
 *  - `deep` (cada 6 h): TODO el catálogo, paginado. Sin esto, un comentario
 *    sobre un video viejo no entraba nunca — así se perdieron 171 de los 193
 *    comentarios de la primera cuenta conectada.
 */
export async function pollAllTikTokConnections(
  opts: { deep?: boolean } = {}
): Promise<{ total: number; ingested: number; videos: number }> {
  const db = supabaseAdmin();
  // error/expired incluidos: getFreshTikTokToken refresca y sana la fila. Mirar
  // sólo 'connected' auto-excluía para siempre a una conexión cuyo refresco
  // falló una vez.
  const conns = await listConnections(db, { channel: 'tiktok_comment' });
  let ingested = 0;
  let videos = 0;

  for (const conn of conns) {
    try {
      const cfg = (conn.config ?? {}) as Record<string, unknown>;
      const businessId = String(cfg.business_id ?? '');
      if (!businessId) continue;
      const token = await getFreshTikTokToken(conn);

      const nuevos = await listVideos(businessId, token, Boolean(opts.deep));
      // Cuáles de estos videos vemos por PRIMERA vez. Se pregunta antes de
      // guardarlos, que es la única forma de saberlo: después del upsert todos
      // figuran conocidos. Sus comentarios son historia —un video puede llegar
      // con cientos de meses atrás— y no se contestan solos.
      const yaConocidos = await videosYaIndexados(db, conn, nuevos);
      // Los videos, guardados: de ahí sale el contexto que necesita quien
      // contesta un comentario (el texto del video y, después, lo que se dice
      // en él). Best-effort: si falla, el poll sigue igual que siempre.
      await guardarVideos(db, conn, nuevos).catch(() => 0);

      // Los 10 más nuevos NO son los que reciben comentarios: en la primera
      // cuenta conectada el video con más tráfico estaba en la posición 18
      // (43 mensajes) y el poll de 5 minutos no lo miraba nunca — sus
      // comentarios esperaban al barrido de 6 h. Se suman los videos que YA
      // tienen actividad reciente en la bandeja, que salen de la base y no
      // cuestan una llamada extra a TikTok para descubrirlos.
      const list = opts.deep
        ? nuevos
        : await conVideosActivos(db, conn, nuevos);
      videos += list.length;
      for (const video of list) {
        const videoId = String(video.item_id ?? video.video_id ?? '');
        if (!videoId) continue;
        const caption = String(video.caption ?? '').slice(0, 80);
        ingested += await ingestVideoComments(
          db,
          conn,
          businessId,
          token,
          videoId,
          caption,
          {
            // Marcar borrados sólo en el barrido profundo: es el único que lee el
            // video entero, y sin la lista completa "no vino" no prueba nada.
            reconcile: Boolean(opts.deep),
            videoNuevo: !yaConocidos.has(videoId),
          }
        );
      }
    } catch (err) {
      console.error(`[tiktok/poll] connection ${conn.id} failed:`, err);
    }
  }
  return { total: conns.length, ingested, videos };
}

/** Recuperación manual de un solo comercio. Recorre el catálogo completo de
 * TikTok y guarda únicamente el rango pedido; jamás activa el agente. */
export async function backfillTikTokCommentsForWorkspace(
  workspaceId: string,
  opts: { sinceMs: number; untilMs: number }
): Promise<{
  connections: number;
  ingested: number;
  videos: number;
  detail: Array<{
    connection_id: string;
    ingested: number;
    videos: number;
    error?: string;
  }>;
}> {
  const db = supabaseAdmin();
  const conns = await listConnections(db, {
    workspaceId,
    channel: 'tiktok_comment',
    statuses: ['connected'],
  });
  let ingested = 0;
  let videos = 0;
  const detail: Array<{
    connection_id: string;
    ingested: number;
    videos: number;
    error?: string;
  }> = [];

  for (const conn of conns) {
    try {
      const businessId = String(
        (conn.config as Record<string, unknown> | null)?.business_id ?? ''
      );
      if (!businessId) {
        detail.push({
          connection_id: conn.id,
          ingested: 0,
          videos: 0,
          error: 'missing_config',
        });
        continue;
      }
      const token = await getFreshTikTokToken(conn);
      const list = await listVideos(businessId, token, true);
      await guardarVideos(db, conn, list).catch(() => 0);
      let connectionIngested = 0;
      for (const video of list) {
        const videoId = String(video.item_id ?? video.video_id ?? '');
        if (!videoId) continue;
        connectionIngested += await ingestVideoComments(
          db,
          conn,
          businessId,
          token,
          videoId,
          String(video.caption ?? '').slice(0, 80),
          {
            fromMs: opts.sinceMs,
            untilMs: opts.untilMs,
            suppressAutoReply: true,
          }
        );
      }
      ingested += connectionIngested;
      videos += list.length;
      detail.push({
        connection_id: conn.id,
        ingested: connectionIngested,
        videos: list.length,
      });
    } catch (error) {
      console.error('[tiktok/backfill] connection failed', {
        connectionId: conn.id,
        error,
      });
      detail.push({
        connection_id: conn.id,
        ingested: 0,
        videos: 0,
        error: 'tiktok_graph_failed',
      });
    }
  }
  return { connections: conns.length, ingested, videos, detail };
}

/**
 * Cuáles de estos videos ya estaban indexados.
 *
 * Es lo que separa "esto es historia" de "esto es una conversación en curso
 * que tardamos en ver". Un video que aparece por primera vez puede traer
 * meses de comentarios de una sola vez: contestarlos todos ahora sería una
 * avalancha sobre gente que preguntó en marzo. Uno que ya seguíamos, no.
 *
 * Ante un error de consulta se responde que TODOS son conocidos: el riesgo
 * de callarse con quien está preguntando ahora es peor que el de contestar
 * un comentario viejo de más.
 */
async function videosYaIndexados(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  videos: Array<Record<string, unknown>>
): Promise<Set<string>> {
  const ids = videos
    .map((v) => String(v.item_id ?? v.video_id ?? ''))
    .filter(Boolean);
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from('tiktok_videos')
    .select('video_id')
    .eq('workspace_id', conn.workspace_id)
    .in('video_id', ids);
  if (error) return new Set(ids);
  return new Set(
    ((data ?? []) as Array<{ video_id: string }>).map((r) => r.video_id)
  );
}

/**
 * Suma a los videos más nuevos los que tienen conversaciones vivas en la
 * bandeja: un anuncio de hace un mes puede seguir juntando comentarios todos
 * los días, y por antigüedad nunca entraba a la corrida de 5 minutos.
 *
 * Los ids salen de `conversations.thread_external_id` ("video:<id>|comment:…"),
 * así que no hace falta pedirle a TikTok el catálogo entero para encontrarlos.
 * El tope existe para que una cuenta con muchos videos activos no convierta el
 * poll liviano en el barrido profundo.
 */
async function conVideosActivos(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  nuevos: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const yaEstan = new Set(
    nuevos.map((v) => String(v.item_id ?? v.video_id ?? '')).filter(Boolean)
  );
  const desde = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const { data } = await db
    .from('conversations')
    .select('thread_external_id, last_message_at')
    .eq('channel', 'tiktok_comment')
    .eq('connection_id', conn.id)
    .gte('last_message_at', desde)
    .order('last_message_at', { ascending: false })
    .limit(200);

  const extra: Array<Record<string, unknown>> = [];
  const vistos = new Set<string>();
  for (const row of (data ?? []) as Array<{
    thread_external_id: string | null;
  }>) {
    const thread = String(row.thread_external_id ?? '');
    if (!thread.startsWith('video:')) continue;
    const id = thread.slice(6).split('|')[0];
    if (!id || yaEstan.has(id) || vistos.has(id)) continue;
    vistos.add(id);
    extra.push({ item_id: id });
    if (extra.length >= ACTIVE_VIDEOS_PER_RUN) break;
  }
  return [...nuevos, ...extra];
}

/**
 * Videos de la cuenta, del más nuevo al más viejo. En modo normal una sola
 * página; en modo profundo pagina con el cursor que devuelve TikTok hasta
 * agotar el catálogo (o el techo de seguridad).
 */
async function listVideos(
  businessId: string,
  token: string,
  deep: boolean
): Promise<Array<Record<string, unknown>>> {
  const headers = { 'Access-Token': token };
  const fields = encodeURIComponent(
    JSON.stringify(['item_id', 'caption', 'create_time', 'share_url'])
  );
  const out: Array<Record<string, unknown>> = [];
  let cursor: string | number | undefined;

  for (let page = 0; page < (deep ? MAX_VIDEO_PAGES : 1); page++) {
    const url =
      `${TT}/business/video/list/?business_id=${encodeURIComponent(businessId)}` +
      `&fields=${fields}&max_count=${deep ? VIDEOS_PER_PAGE : VIDEOS_PER_RUN}` +
      (cursor === undefined
        ? ''
        : `&cursor=${encodeURIComponent(String(cursor))}`);
    const res = await fetch(url, { headers });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      data?: {
        videos?: Array<Record<string, unknown>>;
        has_more?: boolean;
        cursor?: string | number;
      };
    };
    if (!res.ok || (json.code ?? 0) !== 0) break;
    out.push(...(json.data?.videos ?? []));
    if (!json.data?.has_more || json.data.cursor === undefined) break;
    cursor = json.data.cursor;
  }
  return out;
}

/**
 * Ingiere los comentarios de UN video, en los DOS sentidos. Devuelve cuántos
 * eran nuevos. Idempotente por comment_id, así que llamarlo de más no duplica
 * nada — lo usan el cron (todos los videos) y el refresco del hilo abierto.
 *
 * Trae, además del comentario de arriba:
 *  - las respuestas del cliente dentro del hilo;
 *  - **las respuestas que el comercio escribió desde TikTok**, como mensaje
 *    saliente (antes se descartaban por ser "nuestras": el hilo mostraba la
 *    pregunta y nada más, aunque en TikTok estuviera contestada);
 *  - el estado real de cada comentario: oculto y me gusta.
 *
 * Pagina: `max_count` topea en 30, y un video con más de 30 comentarios dejaba
 * al resto afuera para siempre.
 */
/**
 * EL CAMINO RÁPIDO DEL WEBHOOK: ingiere UN comentario y nada más.
 *
 * El webhook de TikTok entrega en menos de un segundo, pero después llamaba a
 * `ingestVideoComments`, que lee el video ENTERO: hasta 20 páginas, y por cada
 * comentario una llamada por sus respuestas y otra por su estado. En un video
 * con 17 comentarios son decenas de llamadas encadenadas ANTES de que el
 * agente vea el comentario nuevo.
 *
 * Medido el 2026-08-27: el comentario entró 22:56:48 y la respuesta salió
 * 23:00:25. Tres minutos y medio, ninguno de TikTok — todos nuestros.
 *
 * Acá se pide una sola página, se busca ese comentario y se ingiere solo. Con
 * eso el agente arranca de inmediato. La lectura completa del video sigue
 * corriendo detrás, sin que nadie la espere: es idempotente, así que traer de
 * nuevo lo que ya entró no duplica nada.
 *
 * Devuelve `false` si el comentario no estaba en la primera página —una
 * respuesta anidada dentro de un hilo largo— y entonces manda el camino
 * completo, que es el único que las ve.
 */
export async function ingestarUnComentario(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  businessId: string,
  token: string,
  videoId: string,
  commentId: string
): Promise<boolean> {
  const url =
    `${TT}/business/comment/list/?business_id=${encodeURIComponent(businessId)}` +
    `&video_id=${encodeURIComponent(videoId)}&max_count=${COMMENTS_PER_VIDEO}`;
  const r = await fetch(url, { headers: { 'Access-Token': token } });
  const j = (await r.json().catch(() => ({}))) as {
    code?: number;
    data?: { comments?: Array<Record<string, unknown>> };
  };
  if (!r.ok || (j.code ?? 0) !== 0) return false;

  const c = (j.data?.comments ?? []).find(
    (x) => String(x.comment_id ?? x.id ?? '') === commentId
  );
  if (!c) return false;

  // El caption del video sale de lo que ya tenemos guardado: pedírselo a
  // TikTok sería otra llamada encadenada, que es justo lo que se vino a sacar.
  const { data: v } = await db
    .from('tiktok_videos')
    .select('caption')
    .eq('workspace_id', conn.workspace_id)
    .eq('video_id', videoId)
    .maybeSingle();
  const caption = String(
    (v as { caption?: string } | null)?.caption ?? ''
  ).slice(0, 80);

  await ingestOne(db, conn, c, {
    videoId,
    caption: caption || undefined,
    topId: commentId,
  });
  return true;
}

export async function ingestVideoComments(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  businessId: string,
  token: string,
  videoId: string,
  caption?: string,
  opts: {
    reconcile?: boolean;
    videoNuevo?: boolean;
    fromMs?: number;
    untilMs?: number;
    suppressAutoReply?: boolean;
  } = {}
): Promise<number> {
  let ingested = 0;
  let cursor: string | number | undefined;
  // Todo lo que TikTok dice que sigue vivo en este video. Con la lista COMPLETA
  // (sin cortes por error ni por tope de páginas) lo que falta es lo que
  // borraron desde la app.
  const vistos = new Set<string>();
  let listaCompleta = true;

  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    // Solo los parámetros requeridos: business_id + video_id + max_count
    // (<=30) + cursor. Sin sort — el poll es idempotente, el orden no importa,
    // y cada parámetro extra es otra validación que puede rebotar con 40002.
    const cUrl =
      `${TT}/business/comment/list/?business_id=${encodeURIComponent(businessId)}` +
      `&video_id=${encodeURIComponent(videoId)}&max_count=${COMMENTS_PER_VIDEO}` +
      (cursor === undefined
        ? ''
        : `&cursor=${encodeURIComponent(String(cursor))}`);
    const cr = await fetch(cUrl, { headers: { 'Access-Token': token } });
    const cj = (await cr.json().catch(() => ({}))) as {
      code?: number;
      data?: {
        comments?: Array<Record<string, unknown>>;
        has_more?: boolean;
        cursor?: string | number;
      };
    };
    if (!cr.ok || (cj.code ?? 0) !== 0) {
      listaCompleta = false;
      break;
    }

    for (const c of cj.data?.comments ?? []) {
      const commentId = String(c.comment_id ?? c.id ?? '');
      if (!commentId) continue;
      vistos.add(commentId);
      // El comentario de arriba es del cliente; el del propio comercio en su
      // video no le responde a nadie, así que no abre hilo.
      if (!isOwn(c, businessId) && isWithinRange(c, opts)) {
        if (
          await ingestOne(db, conn, c, {
            videoId,
            caption,
            topId: commentId,
            videoNuevo: opts.videoNuevo,
            suppressAutoReply: opts.suppressAutoReply,
          })
        ) {
          ingested++;
        }
      }
      await convergeState(db, conn, c);

      // Las RESPUESTAS del hilo, que viajan anidadas en `reply_list`. Acá está
      // lo que el comercio contestó DESDE TikTok: sin esto la bandeja mostraba
      // la pregunta y ninguna respuesta, aunque en TikTok estuviera contestada.
      const replies = await fetchReplies(businessId, token, videoId, c);
      for (const r of replies) {
        const replyId = String(r.comment_id ?? '');
        if (!replyId) continue;
        vistos.add(replyId);
        if (!isWithinRange(r, opts)) continue;
        const wrote = await ingestOne(db, conn, r, {
          videoId,
          caption,
          topId: commentId,
          // La respuesta del comercio es un mensaje SALIENTE del hilo de quien
          // comentó: el contacto sigue siendo el cliente, no nosotros.
          outbound: isOwn(r, businessId),
          contactIdOverride: String(c.user_id ?? ''),
          videoNuevo: opts.videoNuevo,
          suppressAutoReply: opts.suppressAutoReply,
        });
        if (wrote) ingested++;
        await convergeState(db, conn, r);
      }
    }
    if (!cj.data?.has_more || cj.data.cursor === undefined) break;
    cursor = cj.data.cursor;
    if (page === MAX_COMMENT_PAGES - 1) listaCompleta = false;
  }

  if (opts.reconcile && listaCompleta) {
    await marcarBorrados(db, conn, videoId, vistos);
  }
  return ingested;
}

/** ¿Este comentario lo escribió la cuenta del comercio? */
function isOwn(c: Record<string, unknown>, businessId: string): boolean {
  return c.owner === true || String(c.user_id ?? '') === businessId;
}

/**
 * `create_time` viene en dos formatos según dónde lo leas: epoch en segundos
 * en la lista de comentarios ("1787008830") y fecha ya formateada, en UTC y
 * sin zona, dentro de `reply_list` ("2026-08-17 23:49:33"). Leer mal el
 * segundo dejaba la respuesta con fecha inválida y la ordenaba en cualquier
 * lado del hilo.
 */
function parseCreateTime(raw: unknown): number {
  const v = String(raw ?? '').trim();
  if (!v) return Date.now();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const ms = Date.parse(v.replace(' ', 'T') + 'Z');
  return Number.isNaN(ms) ? Date.now() : ms;
}

function isWithinRange(
  comment: Record<string, unknown>,
  opts: { fromMs?: number; untilMs?: number }
): boolean {
  const createdMs = parseCreateTime(comment.create_time);
  return (
    (opts.fromMs === undefined || createdMs >= opts.fromMs) &&
    (opts.untilMs === undefined || createdMs <= opts.untilMs)
  );
}

/** Guarda un comentario (propio o del cliente) en el hilo que le corresponde. */
async function ingestOne(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  c: Record<string, unknown>,
  ctx: {
    videoId: string;
    caption?: string;
    /** Comentario de arriba: es la clave del hilo. */
    topId: string;
    outbound?: boolean;
    /** Para las respuestas: el hilo es del cliente, no de quien responde. */
    contactIdOverride?: string;
    /** Primera vez que indexamos este video: lo que traiga es historia, no
     *  conversación en curso. Ver `VENTANA_RESPUESTA_MS`. */
    videoNuevo?: boolean;
    /** Recuperaciones manuales nunca deben iniciar una respuesta automática. */
    suppressAutoReply?: boolean;
  }
): Promise<boolean> {
  const commentId = String(c.comment_id ?? c.id ?? '');
  if (!commentId) return false;
  // Un comentario sin texto SIGUE siendo un comentario: TikTok devuelve
  // `text: ""` para los de sólo sticker/emoji, y descartarlos dejaba el hilo
  // incompleto (con la respuesta del comercio colgando de una pregunta que no
  // aparecía). Se guarda con el mismo centinela que ya usa la bandeja para lo
  // que la plataforma no entrega legible; la burbuja lo pinta traducido.
  const text = String(c.text ?? '').trim() || UNSUPPORTED_TEXT;
  const username = String(c.username ?? c.user_name ?? '');
  const contactId =
    ctx.contactIdOverride || String(c.user_id ?? username ?? 'tiktok');
  if (!contactId) return false;
  const createdMs = parseCreateTime(c.create_time);

  return Boolean(
    await ingestInboundEvent(db, {
      channel: 'tiktok_comment',
      connection: conn,
      externalContactId: contactId,
      // El nombre sólo lo pisa quien es dueño del hilo: si lo trajera una
      // respuesta nuestra, el contacto pasaría a llamarse como el comercio.
      contactName: ctx.outbound
        ? undefined
        : String(c.display_name ?? username ?? '') || undefined,
      externalMessageId: commentId,
      // One conversation per (video, top-level comment) — replies to the
      // same comment thread together; sendText parses this key.
      externalThreadId: `video:${ctx.videoId}|comment:${ctx.topId}`,
      subject: ctx.caption ? `Video · ${ctx.caption}` : undefined,
      text,
      comment: {
        postId: ctx.videoId,
        parentCommentId: c.parent_comment_id
          ? String(c.parent_comment_id)
          : undefined,
      },
      receivedAt: new Date(createdMs).toISOString(),
      outbound: ctx.outbound,
      // Rescate: entra a la bandeja y suma no leído, pero el agente no
      // contesta solo.
      //
      // Son DOS casos distintos y antes se trataban igual. El video que
      // indexamos por primera vez trae años de comentarios de una: contestarlos
      // todos ahora sería una avalancha sobre gente que preguntó en marzo. Ese
      // se calla siempre. El otro es un comentario de un video que ya seguimos
      // y que tardamos en ver por nuestra propia demora: a ese se le contesta,
      // hasta las 48 horas.
      suppressAutoReply:
        ctx.suppressAutoReply ||
        ctx.videoNuevo ||
        Date.now() - createdMs > VENTANA_RESPUESTA_MS,
      raw: c,
    })
  );
}

/**
 * Lo que le pasó al comentario EN TikTok se refleja acá: ocultarlo o ponerle
 * me gusta desde la app deja de ser invisible para la bandeja. `status` es
 * PUBLIC mientras esté a la vista; cualquier otro valor es que lo ocultaron.
 */
async function convergeState(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  c: Record<string, unknown>
): Promise<void> {
  const commentId = String(c.comment_id ?? c.id ?? '');
  if (!commentId) return;
  const status = typeof c.status === 'string' ? c.status.toUpperCase() : null;
  const liked = typeof c.liked === 'boolean' ? c.liked : null;
  if (status === null && liked === null) return;

  // Una lectura y, sólo si algo cambió de verdad, una escritura. Llamar dos
  // veces a applyCommentLifecycle (una por oculto y otra por me gusta) hacía
  // dos consultas por comentario en cada corrida del poll: sobre 425
  // comentarios y 288 corridas por día eso solo es ruido.
  const { data } = await db
    .from('messages')
    .select(
      'id, sender_type, is_hidden, is_liked, status, content_text, conversations!inner(workspace_id)'
    )
    .eq('channel', 'tiktok_comment')
    .eq('message_id', commentId)
    .eq('conversations.workspace_id', conn.workspace_id);
  for (const row of (data ?? []) as unknown as Array<
    CommentRow & { sender_type: string | null }
  >) {
    // NUESTRA propia respuesta publicada no se tacha por un `status` que no
    // entendemos.
    //
    // `is_hidden` significa "el público no lo ve". Para un comentario ajeno,
    // deducirlo de `status !== PUBLIC` es razonable; para una respuesta que
    // publicó el comercio, no: TikTok usa ese campo también para estados que
    // no son "lo escondí" (revisión, por ejemplo). Medido el 2026-08-29: 265
    // de las 286 filas ocultas del canal eran respuestas propias, todas con
    // `hidden_at` nulo —o sea, nadie las ocultó a propósito— y en TikTok
    // seguían publicadas. Ocultar a mano sí funciona: ese camino sella
    // `hidden_by` y `hidden_at`.
    const propio = row.sender_type !== null && row.sender_type !== 'customer';
    const visibilidad =
      status === null || (propio && status !== 'PUBLIC')
        ? {}
        : (patchFor(row, status === 'PUBLIC' ? 'unhide' : 'hide') ?? {});
    const patch = {
      ...visibilidad,
      ...(liked === null
        ? {}
        : (patchFor(row, liked ? 'like' : 'unlike') ?? {})),
    };
    // Con QUÉ palabra lo dijo TikTok.
    //
    // Se guarda SIEMPRE que el estado no sea PUBLIC, incluso cuando no se
    // toca la visibilidad: es la única forma de aprender el vocabulario real
    // de TikTok y saber cuáles de esos estados significan de verdad "lo
    // escondí". Sin esto, un hilo tachado en la bandeja no se podía explicar
    // — el 2026-08-28 el 74% de las respuestas que el comercio escribió A MANO
    // figuraban ocultas y no hubo forma de saber por qué. Cuesta una columna
    // que ya existe.
    const raro = status !== null && status !== 'PUBLIC';
    if (Object.keys(patch).length === 0 && !raro) continue;
    const conMotivo = raro
      ? { ...patch, meta_status_raw: { tiktok_status: status } }
      : patch;
    await db.from('messages').update(conMotivo).eq('id', row.id);
  }
}

/**
 * Las respuestas de un comentario. Vienen anidadas en `reply_list`, pero ese
 * arreglo trae sólo las primeras: si `replies` dice que hay más, se piden
 * paginadas por su endpoint propio.
 */
async function fetchReplies(
  businessId: string,
  token: string,
  videoId: string,
  parent: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const inline = Array.isArray(parent.reply_list)
    ? (parent.reply_list as Array<Record<string, unknown>>)
    : [];
  const total = Number(parent.replies ?? inline.length) || 0;
  if (total <= inline.length) return inline;

  const parentId = String(parent.comment_id ?? '');
  if (!parentId) return inline;
  const out = new Map<string, Record<string, unknown>>();
  for (const r of inline) out.set(String(r.comment_id ?? ''), r);

  let cursor: string | number | undefined;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const url =
      `${TT}/business/comment/reply/list/?business_id=${encodeURIComponent(businessId)}` +
      `&video_id=${encodeURIComponent(videoId)}&comment_id=${encodeURIComponent(parentId)}` +
      `&max_count=${COMMENTS_PER_VIDEO}` +
      (cursor === undefined
        ? ''
        : `&cursor=${encodeURIComponent(String(cursor))}`);
    const res = await fetch(url, { headers: { 'Access-Token': token } });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      data?: {
        comments?: Array<Record<string, unknown>>;
        has_more?: boolean;
        cursor?: string | number;
      };
    };
    if (!res.ok || (json.code ?? 0) !== 0) break;
    for (const r of json.data?.comments ?? []) {
      const id = String(r.comment_id ?? '');
      if (id) out.set(id, r);
    }
    if (!json.data?.has_more || json.data.cursor === undefined) break;
    cursor = json.data.cursor;
  }
  out.delete('');
  return [...out.values()];
}

/**
 * Lo que ya no está en TikTok se marca borrado acá. Sólo con la lista completa
 * del video: si la lectura se cortó a mitad de camino, "no vino" no significa
 * "lo borraron", y marcar de más vaciaría hilos que están sanos.
 */
async function marcarBorrados(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  videoId: string,
  vistos: Set<string>
): Promise<void> {
  const { data } = await db
    .from('messages')
    .select(
      'id, message_id, meta_status_raw, conversations!inner(workspace_id, thread_external_id)'
    )
    .eq('channel', 'tiktok_comment')
    .eq('conversations.workspace_id', conn.workspace_id)
    .like('conversations.thread_external_id', `video:${videoId}|%`)
    .not('message_id', 'is', null)
    .neq('status', 'failed');
  const locales = (data ?? []) as Array<{
    id: string;
    message_id: string | null;
    meta_status_raw: Record<string, unknown> | null;
  }>;
  const ahora = Date.now();
  for (const row of locales) {
    const id = row.message_id;
    if (!id) continue;
    const marca = row.meta_status_raw ?? {};
    const faltaDesde =
      typeof marca.tiktok_falta_desde === 'string'
        ? marca.tiktok_falta_desde
        : null;

    if (vistos.has(id)) {
      // Reapareció: se limpia la falta para que dos ausencias sueltas y
      // lejanas en el tiempo no se sumen como si fueran seguidas.
      if (faltaDesde) {
        const resto = { ...marca };
        delete resto.tiktok_falta_desde;
        await db
          .from('messages')
          .update({ meta_status_raw: resto })
          .eq('id', row.id);
      }
      continue;
    }

    // Dos ausencias, no una. Marcar borrado es irreversible en la bandeja
    // (el texto se reemplaza por el centinela) y TikTok a veces se saltea un
    // comentario oculto al paginar: una sola lectura floja bastaba para
    // enterrar una respuesta que en TikTok sigue viva.
    if (!faltaDesde) {
      await db
        .from('messages')
        .update({
          meta_status_raw: {
            ...marca,
            tiktok_falta_desde: new Date(ahora).toISOString(),
          },
        })
        .eq('id', row.id);
      continue;
    }
    if (ahora - Date.parse(faltaDesde) < MISSING_GRACE_MS) continue;

    await applyCommentLifecycle(db, {
      channel: 'tiktok_comment',
      workspaceId: conn.workspace_id,
      commentExternalId: id,
      kind: 'delete',
    });
  }
}

/**
 * Refresco puntual de un solo video, para el hilo que el usuario tiene abierto.
 * TikTok no empuja los comentarios al instante (ni siquiera su webhook, que se
 * dispara "dentro de 5 min"), así que mirar un hilo lo mantiene al día sin
 * subir la frecuencia del cron para toda la cuenta.
 */
export async function refreshTikTokVideo(
  conn: ChannelConnection,
  videoId: string
): Promise<number> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? '');
  if (!businessId || !videoId) return 0;
  const token = await getFreshTikTokToken(conn);
  return ingestVideoComments(supabaseAdmin(), conn, businessId, token, videoId);
}
