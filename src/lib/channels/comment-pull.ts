import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, MessageAttachment } from '@/types';
import { decrypt } from './encryption';
import { withAppsecretProof } from './meta-graph';
import { buildSelfCommentEvent } from './comment-echo';
import { findMessageByExternalId } from './message-lookup';
import { listConnections } from './connections';
import { savePollState } from './poll-state';
import { ingestInboundEvent } from './inbox-writer';
import { ingestMetaAttachment } from './media-ingest';
import { isMetaRateLimitedResponse } from './meta-rate-limit';
import { resolveAdAccountIds } from './meta-ads-sync';
import { selectAll } from '@/lib/db/paginate';
import { mapWithConcurrency } from '@/lib/async/concurrency';

/**
 * Comentarios de Instagram y Facebook — lado pull (RED DE SEGURIDAD del webhook).
 *
 * El camino normal es el webhook y es rápido: medido en producción el
 * 2026-07-27, un comentario aparece en la bandeja ~1 segundo después. Este
 * módulo existe para lo que el webhook pierda: una entrega que Meta no
 * reintente, una caída del servicio, un período con la conexión en error.
 *
 * Cubre las DOS direcciones:
 *   - Comentarios de clientes (entrantes).
 *   - Respuestas que el comercio escribió desde la app de Instagram o Facebook.
 *
 * Antes sólo traía las respuestas propias, y sólo de Instagram. Las dos
 * asimetrías costaron caro: entre el 2026-07-29 y el 2026-08-04 la suscripción
 * de Meta quedó apuntando al dominio viejo tras mudar el hosting, y como nada
 * releía los comentarios de clientes, seis días de preguntas no existieron para
 * la bandeja. Facebook además no tenía respaldo de ningún tipo.
 *
 * QUÉ PUBLICACIONES MIRA — y por qué no alcanza con las orgánicas. Medido el
 * 2026-08-07 sobre una cuenta que anuncia: 7 de 8 publicaciones de Instagram con
 * comentarios recientes NO aparecen en `/media`, y la de Facebook no aparece en
 * `/posts`, `/feed`, `/published_posts` ni `/ads_posts`. Son creatividades de
 * anuncios y Graph no las lista por ninguna arista: la única forma de conocerlas
 * es que alguna vez hayan producido un comentario que sí entró. Por eso se unen
 * las publicaciones recientes de la cuenta con las que ya tienen comentarios
 * guardados — y en una cuenta que anuncia, la segunda mitad es la que pesa.
 *
 * Todo lo que trae pasa por `ingestInboundEvent`, que corta duplicados por id
 * externo: repetir una corrida no duplica nada.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
/** No dejar una recuperación manual ocupada indefinidamente por un edge de Meta. */
const GRAPH_TIMEOUT_MS = 30_000;
/** Varias cuentas no deben convertir un respaldo corto en una cola de minutos.
 * Dos en paralelo conserva margen frente a los límites de Meta y evita que una
 * cuenta lenta bloquee a todas las demás. */
const CONNECTION_CONCURRENCY = 2;
const DIA_MS = 24 * 60 * 60 * 1000;
/** Ventana de publicaciones a revisar en régimen — igual que la del
 *  reconciliador. */
const WINDOW_MS = 14 * DIA_MS;
/**
 * Ventana de la PRIMERA pasada completa de una conexión: la historia con la que
 * se entrena al agente. Con 14 días, una cuenta que no publicó en esas dos
 * semanas cerraba su primera pasada con cero publicaciones. La pasada es
 * reanudable —cola de publicaciones y cursores en `config`—, así que no tiene
 * que caber en una corrida; al cerrarla, el respaldo vuelve a los 14 días.
 */
export const HISTORY_WINDOW_MS = 90 * DIA_MS;
/** Marca en `config`: la pasada histórica ya se cerró entera. */
export const COMMENT_HISTORY_DONE = 'comment_history_complete';
/** Marca en `config`: la vuelta en curso descubrió sus publicaciones con la
 *  ventana histórica. */
const COMMENT_HISTORY_STARTED = 'comment_history_started';

/** Qué ventana le toca a la próxima pasada programada de una conexión. */
export function scheduledWindowMs(config: Record<string, unknown> | null | undefined): number {
  return config?.[COMMENT_HISTORY_DONE] === true ? WINDOW_MS : HISTORY_WINDOW_MS;
}

/**
 * Qué anotar en `config` sobre la pasada histórica tras una corrida.
 *
 * Sólo cuenta como cerrada la vuelta que DESCUBRIÓ sus publicaciones con la
 * ventana larga. Una cola heredada —armada antes con 14 días— puede vaciarse
 * primero, y tomarla por la pasada histórica dejaría a esa cuenta sin sus 90
 * días: esa vuelta termina, la siguiente descubre de nuevo y ésa sí cuenta.
 */
export function historyPassPatch(
  config: Record<string, unknown> | null | undefined,
  complete: boolean
): Record<string, unknown> {
  if (config?.[COMMENT_HISTORY_DONE] === true) return {};
  const queue = config?.comment_sync_posts;
  const heredada = Array.isArray(queue) && queue.length > 0;
  const empezada = !heredada || config?.[COMMENT_HISTORY_STARTED] === true;
  if (!empezada) return {};
  if (complete) return { [COMMENT_HISTORY_DONE]: true, [COMMENT_HISTORY_STARTED]: null };
  return { [COMMENT_HISTORY_STARTED]: true };
}
/** Tope de publicaciones por corrida (la siguiente sigue, más nuevas primero). */
const MAX_POSTS_PER_RUN = 40;
/** Comentarios por publicación que pedimos a Graph. */
const COMMENTS_PER_POST = 50;
/** Páginas de comentarios por publicación antes de cortar una paginación anómala. */
const MAX_COMMENT_PAGES = 100;
/**
 * A partir de acá un comentario rescatado entra como HISTORIA: se guarda y se ve
 * en la bandeja, pero no despierta al agente ni a las reglas.
 *
 * El pull corre cada pocos minutos, así que lo que el webhook acaba de perder
 * cae holgadamente por debajo y se atiende en vivo. Lo que aparece más tarde
 * viene de una caída larga —la suscripción de Meta apuntando a un dominio muerto
 * dejó seis días de comentarios afuera— y contestarlo en diferido es peor que no
 * contestarlo: el comercio ya respondió a mano y el cliente recibe una respuesta
 * a algo que preguntó la semana pasada. Pasó de verdad el 2026-08-05.
 */
const LIVE_WINDOW_MS = 60 * 60_000;

type CommentChannel = 'ig_comment' | 'fb_comment';

/** Un comentario tal como lo devuelve Graph, en cualquiera de los dos dialectos. */
interface RawComment {
  id?: string;
  /** Instagram. */
  text?: string;
  timestamp?: string;
  username?: string;
  /** Facebook. */
  message?: string;
  created_time?: string;
  from?: { id?: string; username?: string; name?: string };
  /** Oculto del público: `hidden` en Instagram, `is_hidden` en Facebook. */
  hidden?: boolean;
  is_hidden?: boolean;
  /** Las respuestas anidadas: Instagram las llama `replies`, Facebook `comments`. */
  replies?: { data?: RawComment[] };
  comments?: { data?: RawComment[] };
  /** Facebook: la foto, sticker, GIF o video que acompaña al comentario.
   *  Instagram no expone adjuntos en comentarios. */
  attachment?: CommentAttachment;
}

interface CommentAttachment {
  type?: string;
  url?: string;
  media?: { image?: { src?: string }; source?: string };
}

/**
 * Lo único que cambia entre Instagram y Facebook: cómo se llama cada cosa en
 * Graph. Aislarlo acá evita duplicar el módulo entero por un puñado de nombres.
 */
const DIALECT: Record<
  CommentChannel,
  { edge: string; timeField: string; commentFields: string }
> = {
  ig_comment: {
    edge: 'media',
    timeField: 'timestamp',
    // `hidden` en Instagram, `is_hidden` en Facebook: son campos distintos y
    // no se pueden intercambiar. Vienen desde la ingesta para que un
    // comentario que YA estaba oculto cuando lo trajimos no se vea visible
    // hasta que pase la conciliación, que corre cada diez minutos.
    commentFields:
      'id,text,timestamp,username,hidden,from{id,username},' +
      'replies{id,text,timestamp,username,hidden,from{id,username}}',
  },
  fb_comment: {
    edge: 'posts',
    timeField: 'created_time',
    // `attachment`: la foto (o sticker, GIF, video) del comentario. Sin pedirlo
    // un comentario que era sólo una foto entraba vacío, y el agente no veía
    // lo que el cliente mostraba.
    commentFields:
      'id,message,created_time,is_hidden,from{id,name},attachment,' +
      'comments{id,message,created_time,is_hidden,from{id,name},attachment}',
  },
};

/** Campos de una respuesta sin su propia expansión anidada. */
const REPLY_FIELDS: Record<CommentChannel, string> = {
  ig_comment: 'id,text,timestamp,username,hidden,from{id,username}',
  fb_comment: 'id,message,created_time,is_hidden,from{id,name},attachment',
};

/**
 * El archivo a bajar del adjunto de un comentario de Facebook, o null.
 *
 * Mismos tipos que trae el webhook (`photo`, `video`, `sticker`): con `source`
 * es un video o un GIF animado, si no la imagen. Un enlace compartido (`share`)
 * no se baja: su imagen es la vista previa de un sitio ajeno y el enlace ya
 * está en el texto.
 */
export function commentAttachmentMedia(
  c: { attachment?: CommentAttachment }
): { url: string; kind: 'image' | 'video' } | null {
  const a = c.attachment;
  if (!a) return null;
  const type = String(a.type ?? '').toLowerCase();
  if (type === 'share') return null;
  const video = a.media?.source?.trim();
  if (video) return { url: video, kind: 'video' };
  const image = a.media?.image?.src?.trim();
  if (image) return { url: image, kind: 'image' };
  return null;
}

/** ¿Vino oculto? Instagram lo llama `hidden` y Facebook `is_hidden`. */
function ocultoEn(c: RawComment): boolean {
  return c.hidden === true || c.is_hidden === true;
}

/** El texto del comentario, se llame `text` (Instagram) o `message` (Facebook). */
function textOf(c: RawComment): string {
  return c.text ?? c.message ?? '';
}

/** Cuándo se escribió: `timestamp` en Instagram, `created_time` en Facebook. */
function timeOf(c: RawComment): string | undefined {
  return c.timestamp ?? c.created_time;
}

/** Las respuestas anidadas: `replies` en Instagram, `comments` en Facebook. */
function repliesOf(c: RawComment): RawComment[] {
  return c.replies?.data ?? c.comments?.data ?? [];
}

/**
 * Cómo se muestra quien comentó. Instagram no expone el nombre real, sólo el
 * @usuario — y se guarda con arroba para que la misma persona se lea igual haya
 * comentado o mandado un DM. Facebook sí da el nombre.
 */
function contactNameOf(
  channel: CommentChannel,
  c: RawComment
): string | undefined {
  if (channel === 'fb_comment') return c.from?.name?.trim() || undefined;
  const username = (c.from?.username ?? c.username)?.trim();
  return username ? `@${username}` : undefined;
}

/**
 * Por qué una conexión no trajo nada. Sin esto, "0 comentarios" es ambiguo:
 * puede ser que no haya ninguno que sincronizar o que Meta nos esté negando
 * la lectura de comentarios (`instagram_manage_comments`) — dos situaciones
 * opuestas que se ven igual desde afuera.
 */
export type PullReason =
  | 'ok'
  | 'sin_config'
  | 'graph_denegado'
  | 'sin_publicaciones'
  | 'partial';

export interface PullResult {
  channel: CommentChannel | null;
  /** Comentarios de clientes que faltaban y entraron en esta corrida. */
  ingestedInbound: number;
  /** Respuestas propias que faltaban y entraron en esta corrida. */
  ingested: number;
  /** Publicaciones revisadas. */
  posts: number;
  /** Respuestas nuestras vistas en Graph (ingeridas + ya guardadas). */
  seen: number;
  /** Vistas cuyo comentario padre no está en la bandeja (nada a dónde llevarlas). */
  sinHilo: number;
  /** Vistas que ya estaban guardadas (enviadas desde Riverz o de otra corrida). */
  yaEstaba: number;
  reason: PullReason;
  /** Códigos de fuente que no pudo recorrerse; el detalle queda en logs. */
  errors: string[];
  /** Graph pidió frenar: lo pendiente quedó en la cola para la próxima. */
  rateLimited?: boolean;
  /**
   * Diagnóstico que no es un error. `ad_accounts_not_selected`: la página no
   * tiene cuenta publicitaria elegida, así que los comentarios de anuncios que
   * Graph no lista (dark posts) sólo entran por webhook — explica una pasada
   * con pocas o cero publicaciones en una cuenta que pauta.
   */
  notes?: string[];
}

/** Opciones puntuales para una recuperación histórica, sin cambiar el cron normal. */
export interface CommentPullOptions {
  /** Ventana de publicaciones y comentarios a recuperar. */
  windowMs?: number;
  /** Tope de publicaciones a recorrer para esta ejecución. */
  maxPosts?: number;
  /** No dispara reglas, IA ni respuestas aunque el comentario sea reciente. */
  suppressAutoReply?: boolean;
  /** Durable post queue for the scheduled recovery, independent of manual imports. */
  resumable?: boolean;
  deadlineMs?: number;
  /** Limita la recuperación a los canales elegidos desde Comentarios. */
  channels?: CommentChannel[];
  /** Límite superior inclusivo para una recuperación con rango de fechas. */
  untilMs?: number;
  /** Sin tope artificial de páginas de comentarios en una importación total. */
  maxCommentPages?: number;
  /** En un rango manual, también mira posts viejos con comentarios recientes. */
  includeOlderPosts?: boolean;
}

/**
 * Qué parte de un hilo de comentarios entra en una pasada.
 *
 * Antes mandaba sólo la fecha del comentario raíz: una respuesta de ayer bajo
 * un comentario de hace dos meses quedaba afuera, y con ella lo más reciente
 * de la charla. Ahora alcanza con que cualquier mensaje del hilo esté en la
 * ventana. Si sólo lo están las respuestas, la raíz entra igual como contexto
 * —historia, nunca algo a contestar— para que las respuestas tengan de dónde
 * colgarse y el hilo se lea completo.
 */
export function threadInWindow<T extends { id?: string }>(
  root: T,
  replies: T[],
  inWindow: (c: T) => boolean
): { rootIsContext: boolean; replies: T[] } | null {
  const respuestas = replies.filter((r) => Boolean(r.id) && inWindow(r));
  const raizEnVentana = inWindow(root);
  if (!raizEnVentana && respuestas.length === 0) return null;
  return { rootIsContext: !raizEnVentana, replies: respuestas };
}

/** Trae al inbox los comentarios que falten en UNA conexión. */
export async function pullCommentsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
  options: CommentPullOptions = {}
): Promise<PullResult> {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const maxPosts = options.maxPosts ?? MAX_POSTS_PER_RUN;
  const channel = connection.channel as CommentChannel;
  const isComment = channel === 'ig_comment' || channel === 'fb_comment';
  let notes: string[] = [];
  const empty = (
    reason: PullReason,
    errors: string[] = [],
    extra: Pick<PullResult, 'rateLimited'> = {}
  ): PullResult => ({
    channel: isComment ? channel : null,
    ingestedInbound: 0,
    ingested: 0,
    posts: 0,
    seen: 0,
    sinHilo: 0,
    yaEstaba: 0,
    reason,
    errors,
    ...extra,
    ...(notes.length ? { notes } : {}),
  });
  if (!isComment) return empty('sin_config');
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  // Conexiones hermanas creadas por versiones viejas podían conservar el
  // activo de Instagram sólo en `external_account_id`. Ese id ES el usuario
  // profesional y alcanza para el pull; exigir además la copia en config hacía
  // que una conexión visible como "conectada" devolviera `sin_config`.
  const igUserId = String(
    cfg.ig_user_id ??
      (channel === 'ig_comment' ? connection.external_account_id : '') ??
      ''
  );
  const pageId = String(cfg.page_id ?? (channel === 'fb_comment' ? connection.external_account_id : '') ?? '');
  // Instagram cuelga los comentarios de la cuenta profesional; Facebook, de la
  // página.
  const target = channel === 'ig_comment' ? igUserId : pageId;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? '');
  if (!target || !enc) return empty('sin_config');
  let token: string;
  try {
    token = decrypt(enc);
  } catch {
    return empty('sin_config');
  }

  // Sin cuenta publicitaria elegida para la página, los anuncios que Graph no
  // lista no se pueden descubrir. No es un error —es válido no pautar— pero
  // queda dicho en el resultado, que es donde se mira una pasada con cero
  // publicaciones.
  if ((await resolveAdAccountIds(db, connection)).length === 0) {
    notes = ['ad_accounts_not_selected'];
  }

  // Qué cuenta somos NOSOTROS. Por id siempre. En Instagram, además, por
  // @usuario: Graph no siempre devuelve `from` en los comentarios, y sin ese
  // dato no se puede distinguir lo nuestro de lo del cliente. Leerlo sirve
  // encima de sonda de permisos — si ni eso deja, mejor no tocar nada.
  const selfIds = new Set([igUserId, pageId].filter(Boolean));
  let selfUsername = '';
  if (channel === 'ig_comment') {
    const u = await fetchSelfUsername(target, token);
    if (u.rateLimited) {
      return empty('partial', ['comments_sync_pending'], { rateLimited: true });
    }
    if (!u.username) return empty('graph_denegado');
    selfUsername = u.username;
  }

  const queued = options.resumable && Array.isArray(cfg.comment_sync_posts) ? cfg.comment_sync_posts as string[] : [];
  const postsToRead = queued.length ? { ids: queued, errors: [], rateLimited: false } : await postsToScan(
    db,
    connection,
    channel,
    target,
    token,
    {
      windowMs,
      maxPosts: options.resumable ? 10_000 : maxPosts,
      includeOlderPosts: options.includeOlderPosts,
    }
  );
  // Frenado a mitad del descubrimiento: una cola parcial se tomaría por
  // completa. No se guarda nada y la próxima corrida vuelve a descubrir.
  if (postsToRead.rateLimited) {
    return empty('partial', ['comments_sync_pending'], { rateLimited: true });
  }
  const postIds = postsToRead.ids.slice(0, maxPosts);
  const remaining = postsToRead.ids.slice(maxPosts);
  if (postIds.length === 0) {
    return empty(
      postsToRead.errors.length > 0 ? 'graph_denegado' : 'sin_publicaciones',
      postsToRead.errors
    );
  }

  let ingestedInbound = 0;
  let ingested = 0;
  let seen = 0;
  let sinHilo = 0;
  let yaEstaba = 0;
  let rateLimited = false;
  const errors = [...postsToRead.errors];
  const commentCursors = { ...(cfg.comment_sync_cursors as Record<string, string> ?? {}) };
  const replyCursors = { ...(cfg.comment_sync_reply_cursors as Record<string, string> ?? {}) };
  const inWindow = (c: RawComment) => isWithinWindow(c, windowMs, options.untilMs);
  for (let i = 0; i < postIds.length; i++) {
    const postId = postIds[i];
    if (options.deadlineMs && Date.now() >= options.deadlineMs) {
      remaining.push(...postIds.slice(i));
      break;
    }
    const fetched = await fetchCommentsWithReplies(
      channel,
      postId,
      token,
      options.maxCommentPages ?? MAX_COMMENT_PAGES,
      options.resumable ? commentCursors[postId] : undefined,
      options.resumable ? replyCursors : undefined,
      options.deadlineMs,
    );
    if (options.resumable && fetched.pending) {
      remaining.push(postId);
      commentCursors[postId] = fetched.after ?? '';
    } else if (!fetched.failed) delete commentCursors[postId];
    if (fetched.failed) {
      errors.push('comments_graph_failed');
      if (options.resumable) remaining.push(postId);
    }
    for (const comment of fetched.comments) {
      const parentId = comment.id;
      if (!parentId) continue;
      const replies = repliesOf(comment);
      const tramo = threadInWindow(comment, replies, inWindow);
      if (!tramo) continue;
      // El comentario de nivel superior: si es de un cliente y no está, entra.
      // Ya contestado por el comercio ⇒ historia, aunque sea reciente: nadie
      // tiene que responder dos veces lo mismo. Si entra sólo como contexto
      // de sus respuestas, también es historia.
      const answered = replies.some((r) => isSelf(r, selfIds, selfUsername));
      if (!isSelf(comment, selfIds, selfUsername)) {
        if (
          await ingestCustomerComment(
            db,
            connection,
            channel,
            comment,
            postId,
            null,
            answered,
            options.suppressAutoReply === true || tramo.rootIsContext,
            token
          )
        ) {
          ingestedInbound++;
        }
      }
      for (const reply of tramo.replies) {
        if (!reply.id) continue;
        if (!isSelf(reply, selfIds, selfUsername)) {
          if (
            await ingestCustomerComment(
              db,
              connection,
              channel,
              reply,
              postId,
              parentId,
              false,
              options.suppressAutoReply === true,
              token
            )
          ) {
            ingestedInbound++;
          }
          continue;
        }
        seen++;
        const event = await buildSelfCommentEvent(db, {
          channel,
          connection,
          commentId: reply.id,
          parentCommentId: parentId,
          postId,
          text: textOf(reply),
          receivedAt: parseMetaTimestamp(timeOf(reply)),
        });
        if (!event) {
          sinHilo++;
          continue;
        }
        // ingestInboundEvent es idempotente por id externo: si la respuesta ya
        // está (la escribimos desde Riverz, o la trajo una corrida anterior)
        // devuelve null y no duplica nada.
        const written = await ingestInboundEvent(db, event);
        if (written) ingested++;
        else yaEstaba++;
      }
    }
    // Graph pidió frenar: lo ya leído entró, y esta publicación (con su
    // cursor) y las que faltan quedan en la cola para la corrida siguiente.
    if (fetched.rateLimited) {
      rateLimited = true;
      remaining.push(...postIds.slice(i + 1));
      break;
    }
  }
  if (options.resumable) {
    await savePollState(db, connection.id, {
      comment_sync_posts: [...new Set(remaining)],
      comment_sync_cursors: commentCursors,
      comment_sync_reply_cursors: replyCursors,
    }, null, { complete: false });
    if (remaining.length) errors.push('comments_sync_pending');
  }
  if (rateLimited) errors.push('comments_sync_pending');
  return {
    channel,
    ingestedInbound,
    ingested,
    posts: postIds.length,
    seen,
    sinHilo,
    yaEstaba,
    reason: errors.length > 0 ? 'partial' : 'ok',
    errors: Array.from(new Set(errors)),
    ...(rateLimited ? { rateLimited: true } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

/** Corre el pull en todas las conexiones de comentarios, de los dos canales. */
export async function pullCommentsAll(db: SupabaseClient): Promise<{
  connections: number;
  ingestedInbound: number;
  ingested: number;
  seen: number;
  detail: Array<{ connection_id: string } & PullResult>;
}> {
  const list = await listConnections(db, {
    channels: ['ig_comment', 'fb_comment'],
  });
  list.sort((a, b) => String(a.config?.comment_sync_attempt_at ?? '').localeCompare(String(b.config?.comment_sync_attempt_at ?? '')));
  const deadline = Date.now() + 3 * 60_000;
  // Si Graph frena a una cuenta, el límite puede ser de la app entera: las que
  // todavía no empezaron esperan a la corrida siguiente en vez de sumar golpes.
  let frenado = false;

  const detail = await mapWithConcurrency(
    list,
    CONNECTION_CONCURRENCY,
    async (c) => {
      try {
        const lastSync = Date.parse(c.last_synced_at ?? '');
        const requested = Date.parse(String(c.config?.sync_requested_at ?? '')) || 0;
        if (c.config?.comment_sync_complete === true && requested <= lastSync && Date.now() - lastSync < 10 * 60_000) {
          return { connection_id: c.id, channel: c.channel as CommentChannel,
            ingestedInbound: 0, ingested: 0, posts: 0, seen: 0, sinHilo: 0, yaEstaba: 0,
            reason: 'ok' as const, errors: [] };
        }
        if (Date.now() >= deadline) return { connection_id: c.id, ...failedConnectionResult(c) };
        if (frenado) return { connection_id: c.id, ...rateLimitedResult(c) };
        await savePollState(db, c.id, { comment_sync_attempt_at: new Date().toISOString() }, null, { complete: false });
        const r = await pullCommentsForConnection(db, c, {
          suppressAutoReply: true, resumable: true, deadlineMs: Math.min(deadline, Date.now() + 45_000),
          windowMs: scheduledWindowMs(c.config),
        });
        if (r.rateLimited) frenado = true;
        const complete = r.reason === 'ok' || r.reason === 'sin_publicaciones';
        const pendingOnly = r.errors.length > 0 && r.errors.every(e => e === 'comments_sync_pending');
        await savePollState(db, c.id, { comment_sync_complete: complete, ...historyPassPatch(c.config, complete) },
          complete || pendingOnly ? null : `comment_sync:${r.reason}:${r.errors.join(',')}`,
          { complete, clearErrorPrefix: pendingOnly ? 'comment_sync:' : undefined });
        return { connection_id: c.id, ...r };
      } catch (err) {
        console.error('[comment-pull] conexión falló:', c.id, err);
        return { connection_id: c.id, ...failedConnectionResult(c) };
      }
    }
  );
  const ingestedInbound = detail.reduce(
    (sum, row) => sum + row.ingestedInbound,
    0
  );
  const ingested = detail.reduce((sum, row) => sum + row.ingested, 0);
  const seen = detail.reduce((sum, row) => sum + row.seen, 0);
  return { connections: list.length, ingestedInbound, ingested, seen, detail };
}

/** Recupera únicamente los comentarios de un workspace (por ejemplo, un backfill). */
export async function pullCommentsForWorkspace(
  db: SupabaseClient,
  workspaceId: string,
  options: CommentPullOptions = {}
): Promise<{
  connections: number;
  ingestedInbound: number;
  ingested: number;
  seen: number;
  detail: Array<{ connection_id: string } & PullResult>;
}> {
  const list = await listConnections(db, {
    workspaceId,
    channels: options.channels ?? ['ig_comment', 'fb_comment'],
  });
  const detail = await mapWithConcurrency(
    list,
    CONNECTION_CONCURRENCY,
    async (connection) => {
      try {
        const result = await pullCommentsForConnection(db, connection, options);
        return { connection_id: connection.id, ...result };
      } catch (err) {
        console.error('[comment-pull] conexión falló:', connection.id, err);
        // El caller necesita saber que faltó una fuente; omitirla acá hacía que
        // la ruta HTTP pudiera anunciar una recuperación completa por error.
        return {
          connection_id: connection.id,
          ...failedConnectionResult(connection),
        };
      }
    }
  );
  const ingestedInbound = detail.reduce(
    (sum, result) => sum + result.ingestedInbound,
    0
  );
  const ingested = detail.reduce((sum, result) => sum + result.ingested, 0);
  const seen = detail.reduce((sum, result) => sum + result.seen, 0);
  return { connections: list.length, ingestedInbound, ingested, seen, detail };
}

/** Cuenta que no se tocó porque Graph ya había frenado a otra en esta corrida.
 *  No es un error: su cola y sus cursores siguen intactos. */
function rateLimitedResult(connection: ChannelConnection): PullResult {
  return {
    ...failedConnectionResult(connection),
    errors: ['comments_sync_pending'],
    rateLimited: true,
  };
}

function failedConnectionResult(connection: ChannelConnection): PullResult {
  const channel = connection.channel;
  return {
    channel:
      channel === 'ig_comment' || channel === 'fb_comment' ? channel : null,
    ingestedInbound: 0,
    ingested: 0,
    posts: 0,
    seen: 0,
    sinHilo: 0,
    yaEstaba: 0,
    reason: 'partial',
    errors: ['connection_failed'],
  };
}

/** ¿Lo escribió la cuenta del comercio? Se mira el id (fiable) y, si Graph no
 *  lo devuelve, el @usuario de Instagram. */
function isSelf(
  c: RawComment,
  selfIds: Set<string>,
  selfUsername: string
): boolean {
  const fromId = c.from?.id;
  if (fromId) return selfIds.has(String(fromId));
  return (
    Boolean(selfUsername) && (c.username ?? c.from?.username) === selfUsername
  );
}

function isWithinWindow(
  comment: RawComment,
  windowMs: number,
  untilMs?: number
): boolean {
  const timestamp = Date.parse(parseMetaTimestamp(timeOf(comment)));
  return (
    Number.isFinite(timestamp) &&
    timestamp >= Date.now() - windowMs &&
    (untilMs === undefined || timestamp <= untilMs)
  );
}

/**
 * Un comentario de cliente que el webhook no trajo. Se arma igual que en el
 * adapter para que el corte de duplicados por id externo funcione idéntico.
 * Devuelve true sólo si la fila entró (no estaba antes).
 *
 * `alreadyAnswered` viene de las respuestas que el propio pull ya leyó: junto
 * con la antigüedad decide si esto todavía es algo a lo que contestar o si es
 * historia que sólo hay que dejar visible.
 *
 * La foto, sticker o GIF del comentario pasa por la misma ingesta que el
 * webhook (re-hospedada en Storage: la URL del CDN caduca).
 */
async function ingestCustomerComment(
  db: SupabaseClient,
  connection: ChannelConnection,
  channel: CommentChannel,
  comment: RawComment,
  postId: string,
  parentCommentId: string | null,
  alreadyAnswered: boolean,
  forceSuppressAutoReply: boolean,
  token: string
): Promise<boolean> {
  const commentId = comment.id;
  // Sin id de autor no hay a quién atribuirlo: crear un contacto fantasma sería
  // peor que dejarlo fuera (el hilo no podría responderse ni fusionarse).
  const authorId = comment.from?.id;
  if (!commentId || !authorId) return false;
  const receivedAt = parseMetaTimestamp(timeOf(comment));
  // Un timestamp ilegible cae del lado seguro (NaN hace fallar el `<`): mejor
  // no contestar de más que contestar tarde.
  const age = Date.now() - Date.parse(receivedAt);
  const suppressAutoReply =
    forceSuppressAutoReply || alreadyAnswered || !(age < LIVE_WINDOW_MS);
  let attachments: MessageAttachment[] | undefined;
  const media = commentAttachmentMedia(comment);
  if (media) {
    // El pull relee los mismos comentarios en cada vuelta: la foto se baja la
    // primera vez, no en cada pasada sobre un comentario que ya está.
    const ya = await findMessageByExternalId(db, {
      workspaceId: connection.workspace_id,
      channel,
      externalMessageId: commentId,
    });
    if (ya) return false;
    const bajada = await ingestMetaAttachment({
      attachmentUrl: media.url,
      workspaceId: connection.workspace_id,
      conversationId: String(authorId),
      externalMessageId: commentId,
      hintedKind: media.kind,
      accessToken: token,
    });
    if (bajada) {
      attachments = [
        { url: bajada.url, mime_type: bajada.mediaMime, size: bajada.mediaSize },
      ];
    }
  }
  const written = await ingestInboundEvent(db, {
    channel,
    connection,
    externalContactId: String(authorId),
    contactName: contactNameOf(channel, comment),
    externalMessageId: commentId,
    text: textOf(comment),
    attachments,
    comment: {
      postId,
      parentCommentId: parentCommentId ?? undefined,
    },
    receivedAt,
    suppressAutoReply,
    historical: forceSuppressAutoReply,
  });
  // Ya venía oculto de la red. Sin anotarlo acá el comentario entra como
  // visible y se ve así hasta que pase la conciliación —diez minutos— justo
  // en el caso en que el comercio acaba de ocultarlo y viene a comprobar que
  // quedó bien.
  if (written && ocultoEn(comment)) {
    // Por la fila de ESTE workspace. Filtrando por `message_id` a secas, la
    // misma cuenta conectada en dos comercios ocultaba el comentario en los
    // dos.
    const fila = await findMessageByExternalId(db, {
      workspaceId: connection.workspace_id,
      channel,
      externalMessageId: commentId,
    });
    if (fila) {
      await db
        .from('messages')
        .update({
          is_hidden: true,
          hidden_by: 'red',
          hidden_at: new Date().toISOString(),
        })
        .eq('id', fila.id);
    }
  }
  return Boolean(written);
}

/**
 * Publicaciones a revisar: las recientes de la cuenta según Graph, más aquellas
 * donde ya hay comentarios guardados. La primera mitad cubre la publicación
 * nueva que nunca tuvo comentarios en Riverz; la segunda —y es la que más pesa
 * en una cuenta que anuncia— cubre las creatividades de anuncios, que Graph no
 * lista por ninguna arista y sólo conocemos porque alguna vez llegó un
 * comentario suyo.
 */
async function postsToScan(
  db: SupabaseClient,
  connection: ChannelConnection,
  channel: CommentChannel,
  target: string,
  token: string,
  options: { windowMs: number; maxPosts: number; includeOlderPosts?: boolean }
): Promise<{ ids: string[]; errors: string[]; rateLimited: boolean }> {
  // MITAD Y MITAD, no "primero las recientes y si sobra lugar las otras".
  //
  // Antes se llenaba el cupo con `recentPostIds` y recién después se sumaban
  // las publicaciones que ya tenían comentarios guardados — así que una cuenta
  // que publica cuarenta veces en catorce días no escaneaba NINGUNA creatividad
  // de anuncio. Y esa es la razón de ser de este módulo: medido el 2026-08-07,
  // 7 de 8 publicaciones de Instagram con comentarios recientes no aparecen en
  // `/media`, porque son anuncios. En una cuenta que pauta, la mitad que se
  // estaba descartando es la que pesa.
  const mitad = Math.ceil(options.maxPosts / 2);
  const recientes = await recentPostIds(channel, target, token, options);
  const conComentarios = await postIdsWithSavedComments(
    db,
    connection,
    channel,
    options
  );
  const ids = new Set<string>(recientes.ids.slice(0, mitad));
  for (const id of conComentarios) {
    if (ids.size >= options.maxPosts) break;
    ids.add(id);
  }
  // Si una de las dos fuentes trajo poco, la otra usa lo que sobró.
  for (const id of recientes.ids) {
    if (ids.size >= options.maxPosts) break;
    ids.add(id);
  }
  return {
    ids: [...ids].slice(0, options.maxPosts),
    errors: recientes.errors,
    rateLimited: recientes.rateLimited,
  };
}

/** Publicaciones recientes de la cuenta, dentro de la ventana. */
async function recentPostIds(
  channel: CommentChannel,
  target: string,
  token: string,
  options: { windowMs: number; maxPosts: number; includeOlderPosts?: boolean }
): Promise<{ ids: string[]; errors: string[]; rateLimited: boolean }> {
  const { edge, timeField } = DIALECT[channel];
  const since = Date.now() - options.windowMs;
  const ids: string[] = [];
  const errors: string[] = [];
  try {
    const edges = channel === 'fb_comment' ? [edge, 'feed'] : [edge];
    for (const currentEdge of edges) {
      let url: string | null = withAppsecretProof(
        `${GRAPH}/${target}/${currentEdge}?fields=id,${timeField}&limit=${Math.min(options.maxPosts, 100)}` +
          `&access_token=${encodeURIComponent(token)}`,
        token
      );
      let reachedWindowStart = false;
      while (url && ids.length < options.maxPosts && !reachedWindowStart) {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        });
        if (!res.ok) {
          if (await isMetaRateLimitedResponse(res)) {
            return { ids, errors, rateLimited: true };
          }
          errors.push('posts_graph_failed');
          break;
        }
        const json = (await res.json()) as {
          data?: RawComment[];
          paging?: { next?: string };
        };
        for (const m of json.data ?? []) {
          if (!m.id) continue;
          const ms = Date.parse(parseMetaTimestamp(timeOf(m)));
          if (
            options.includeOlderPosts ||
            !Number.isFinite(ms) ||
            ms >= since
          ) {
            ids.push(String(m.id));
          } else {
            // Los edges de publicaciones vienen de más nuevo a más viejo. En
            // un rango acotado no hay razón para seguir paginando una vez que
            // la página ya cruzó el inicio; de hacerlo, un backfill de 90 días
            // podía terminar recorriendo toda la vida de la página.
            reachedWindowStart = true;
            break;
          }
        }
        url = json.paging?.next
          ? withAppsecretProof(json.paging.next, token)
          : null;
      }
    }
    return { ids: ids.slice(0, options.maxPosts), errors, rateLimited: false };
  } catch (error) {
    console.warn('[comment-pull] post discovery failed', {
      channel,
      target,
      error,
    });
    return { ids, errors: [...errors, 'posts_graph_failed'], rateLimited: false };
  }
}

/** Publicaciones con comentarios recientes ya guardados en esta conexión. */
async function postIdsWithSavedComments(
  db: SupabaseClient,
  connection: ChannelConnection,
  channel: CommentChannel,
  options: { windowMs: number; maxPosts: number }
): Promise<string[]> {
  const sinceIso = new Date(Date.now() - options.windowMs).toISOString();
  // Por la conexión DUEÑA del comentario (`comments_meta`), no por la de la
  // conversación: con dos páginas del mismo comercio, la conversación es de la
  // primera y la publicación de la segunda no se volvía a escanear nunca.
  const propios = await selectAll<{ message_id: string; post_id: string | null }>(
    db, 'comments_meta', q => q.eq('connection_id', connection.id),
    { select: 'message_id, post_id', orderBy: 'message_id', strict: true },
  );
  const deMeta = (propios ?? []) as Array<{
    message_id: string;
    post_id: string | null;
  }>;

  // Las creatividades de anuncios —en especial los dark posts— no aparecen
  // en /media ni /posts. `ads-sync` las descubre desde /ads_posts y las deja
  // por conexión; sin sumarlas acá, un backfill inicial sólo ve el puñado de
  // publicaciones orgánicas y pierde justamente la mayor parte de comentarios
  // de una cuenta que pauta.
  const adPosts = await selectAll<{ post_id: string | null }>(
    db,
    'ad_posts',
    (q) =>
      q
        .eq('connection_id', connection.id)
        .order('last_seen_at', { ascending: false }),
    { select: 'post_id' }
  );

  const { data: msgs } = await db
    .from('messages')
    .select('id, conversations!inner(connection_id)')
    .eq('channel', channel)
    .eq('conversations.connection_id', connection.id)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(300);
  const messageIds = ((msgs ?? []) as Array<{ id: string }>).map((m) => m.id);
  if (messageIds.length === 0 && deMeta.length === 0 && adPosts.length === 0)
    return [];

  const { data: metas } = await db
    .from('comments_meta')
    .select('post_id')
    .in('message_id', messageIds);
  const seen = new Set<string>();
  for (const ad of adPosts) {
    if (ad.post_id) seen.add(ad.post_id);
    if (seen.size >= options.maxPosts) break;
  }
  for (const m of deMeta) {
    if (m.post_id) seen.add(m.post_id);
    if (seen.size >= options.maxPosts) break;
  }
  for (const m of (metas ?? []) as Array<{ post_id: string | null }>) {
    if (m.post_id) seen.add(m.post_id);
    if (seen.size >= options.maxPosts) break;
  }
  return [...seen];
}

/** El @usuario propio. Un límite de uso no es un permiso negado: se distingue
 *  para no marcar la conexión en error por algo que se cura solo. */
async function fetchSelfUsername(
  igUserId: string,
  token: string
): Promise<{ username: string | null; rateLimited: boolean }> {
  const url = withAppsecretProof(
    `${GRAPH}/${igUserId}?fields=username&access_token=${encodeURIComponent(token)}`,
    token
  );
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { username: null, rateLimited: await isMetaRateLimitedResponse(res) };
    }
    const json = (await res.json()) as { username?: string };
    return { username: json.username?.trim() || null, rateLimited: false };
  } catch {
    return { username: null, rateLimited: false };
  }
}

async function fetchCommentsWithReplies(
  channel: CommentChannel,
  postId: string,
  token: string,
  maxPages: number,
  after?: string,
  replyCursors?: Record<string, string>,
  deadlineMs?: number,
): Promise<{
  comments: RawComment[];
  failed: boolean;
  pending?: boolean;
  after?: string;
  /** Graph pidió frenar: se devuelve lo leído y el cursor con el que se entró. */
  rateLimited?: boolean;
}> {
  let url: string | null = withAppsecretProof(
    `${GRAPH}/${postId}/comments?fields=${encodeURIComponent(DIALECT[channel].commentFields)}` +
      `&limit=${COMMENTS_PER_POST}&access_token=${encodeURIComponent(token)}`,
    token
  );
  const comments: RawComment[] = [];
  if (after) url += `&after=${encodeURIComponent(after)}`;
  let failed = false;
  let repliesPending = false;
  let rateLimited = false;
  try {
    for (let page = 0; url && page < maxPages; page++) {
      if (deadlineMs && Date.now() >= deadlineMs) break;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Una publicación borrada sigue en nuestro histórico y puede aparecer
        // en comments_meta durante la ventana de rescate. Graph 100/33 sólo
        // dice que ese objeto ya no existe o dejó de ser visible; no implica
        // que la conexión, el token o el resto de comentarios hayan fallado.
        if (await isMissingGraphObject(res)) {
          return { comments, failed: false };
        }
        if (await isMetaRateLimitedResponse(res)) {
          rateLimited = true;
          break;
        }
        failed = true;
        break;
      }
      const json = (await res.json()) as {
        data?: RawComment[];
        paging?: { next?: string };
      };
      comments.push(...(json.data ?? []));
      url = json.paging?.next
        ? withAppsecretProof(json.paging.next, token)
        : null;
    }
    // La expansión `replies{…}` de Graph viene paginada por separado y por
    // defecto deja respuestas fuera. Leemos el edge de cada comentario para
    // que un backfill sea realmente completo, tanto en Facebook como IG.
    for (const comment of comments) {
      if (rateLimited) break;
      if (!comment.id) continue;
      if (replyCursors?.[comment.id] === '__complete__') continue;
      if (deadlineMs && Date.now() >= deadlineMs) { repliesPending = true; break; }
      const replyResult = await fetchAllReplies(
        channel,
        comment.id,
        token,
        maxPages,
        replyCursors?.[comment.id],
      );
      if (replyResult.rateLimited) {
        // Sin marcarlo completo: la próxima corrida vuelve a pedir sus
        // respuestas desde el cursor que ya tenía.
        rateLimited = true;
        break;
      }
      if (replyResult.after && replyCursors) {
        replyCursors[comment.id] = replyResult.after;
        repliesPending = true;
      } else if (!replyResult.failed && replyCursors) replyCursors[comment.id] = '__complete__';
      if (replyResult.failed) failed = true;
      const replies = replyResult.replies ?? repliesOf(comment);
      if (channel === 'ig_comment') comment.replies = { data: replies };
      else comment.comments = { data: replies };
    }
    if (rateLimited) {
      // Se vuelve a entrar por el mismo cursor: las páginas ya leídas se
      // releen (es idempotente) y así ninguna respuesta queda sin pedir.
      return { comments, failed, pending: true, after, rateLimited: true };
    }
    if (!repliesPending && !failed && replyCursors) {
      for (const comment of comments) if (comment.id) delete replyCursors[comment.id];
    }
    return {
      comments, failed,
      pending: Boolean(url) || repliesPending,
      after: failed || repliesPending ? after : url ? new URL(url).searchParams.get('after') ?? undefined : undefined,
    };
  } catch (error) {
    console.warn('[comment-pull] comments discovery failed', {
      channel,
      postId,
      error,
    });
    return { comments, failed: true };
  }
}

async function fetchAllReplies(
  channel: CommentChannel,
  commentId: string,
  token: string,
  maxPages: number,
  after?: string,
): Promise<{
  replies: RawComment[] | null;
  failed: boolean;
  after?: string;
  rateLimited?: boolean;
}> {
  const edge = channel === 'ig_comment' ? 'replies' : 'comments';
  let url: string | null = withAppsecretProof(
    `${GRAPH}/${commentId}/${edge}?fields=${encodeURIComponent(REPLY_FIELDS[channel])}` +
      `&limit=${COMMENTS_PER_POST}&access_token=${encodeURIComponent(token)}`,
    token
  );
  const replies: RawComment[] = [];
  if (after) url += `&after=${encodeURIComponent(after)}`;
  try {
    for (let page = 0; url && page < maxPages; page++) {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (await isMetaRateLimitedResponse(res)) {
          return { replies: null, failed: false, rateLimited: true };
        }
        // El comentario puede desaparecer entre leer el padre y pedir sus
        // respuestas. Es el mismo borrado normal, no un problema del canal.
        return {
          replies: null,
          failed: !(await isMissingGraphObject(res)),
        };
      }
      const json = (await res.json()) as {
        data?: RawComment[];
        paging?: { next?: string };
      };
      replies.push(...(json.data ?? []));
      url = json.paging?.next
        ? withAppsecretProof(json.paging.next, token)
        : null;
    }
  } catch {
    // Conservamos las respuestas que Graph ya incluyó en la publicación si
    // este edge puntual falla, en vez de perder todo el comentario padre.
    return { replies: null, failed: true };
  }
  return { replies, failed: false, after: url ? new URL(url).searchParams.get('after') ?? undefined : undefined };
}

/** Meta Graph: objeto eliminado/inaccesible, código 100 y subcódigo 33. */
async function isMissingGraphObject(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: number; error_subcode?: number };
    };
    return body.error?.code === 100 && body.error?.error_subcode === 33;
  } catch {
    return false;
  }
}

/** Meta devuelve "2026-07-27T12:00:00+0000" (sin dos puntos en el huso). */
function parseMetaTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : new Date().toISOString();
}
