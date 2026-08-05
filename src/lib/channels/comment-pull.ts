import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { buildSelfCommentEvent } from "./comment-echo";
import { ingestInboundEvent } from "./inbox-writer";

/**
 * Comentarios de Instagram — lado pull (RED DE SEGURIDAD del webhook).
 *
 * El camino normal es el webhook y es rápido: medido en producción el
 * 2026-07-27, un comentario aparece en la bandeja ~1 segundo después. Este
 * módulo existe para lo que el webhook pierda: una entrega que Meta no
 * reintente, una caída del servicio, un período con la conexión en error.
 *
 * Cubre las DOS direcciones:
 *   - Comentarios de clientes (entrantes).
 *   - Respuestas que el comercio escribió desde la app de Instagram.
 *
 * Antes sólo traía las respuestas propias, y esa asimetría costó caro: entre el
 * 2026-07-29 y el 2026-08-04 la suscripción de Meta quedó apuntando al dominio
 * viejo tras mudar el hosting, y como nada más releía los comentarios de
 * clientes, seis días de preguntas no existieron para la bandeja.
 *
 * Qué publicaciones mira: las recientes de la cuenta (Graph) unidas a aquellas
 * donde ya hay comentarios guardados. Lo primero cubre un post nuevo que nunca
 * tuvo comentarios en Riverz; lo segundo, un post viejo que sigue recibiendo.
 *
 * Todo lo que trae pasa por `ingestInboundEvent`, que corta duplicados por id
 * externo: repetir una corrida no duplica nada.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
/** Ventana de publicaciones a revisar — igual que la del reconciliador. */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Tope de publicaciones por corrida (la siguiente sigue, más nuevas primero). */
const MAX_POSTS_PER_RUN = 40;
/** Comentarios por publicación que pedimos a Graph. */
const COMMENTS_PER_POST = 50;
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

interface IgAuthor {
  id?: string;
  username?: string;
}

interface IgReply {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  from?: IgAuthor;
}

interface IgComment extends IgReply {
  replies?: { data?: IgReply[] };
}

/**
 * Por qué una conexión no trajo nada. Sin esto, "0 comentarios" es ambiguo:
 * puede ser que no haya ninguno que sincronizar o que Meta nos esté negando
 * la lectura de comentarios (`instagram_manage_comments`) — dos situaciones
 * opuestas que se ven igual desde afuera.
 */
export type PullReason =
  | "ok"
  | "sin_config"
  | "graph_denegado"
  | "sin_publicaciones";

export interface PullResult {
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
}

/** Trae al inbox los comentarios que falten en UNA conexión de Instagram. */
export async function pullCommentsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<PullResult> {
  const empty = (reason: PullReason): PullResult => ({
    ingestedInbound: 0,
    ingested: 0,
    posts: 0,
    seen: 0,
    sinHilo: 0,
    yaEstaba: 0,
    reason,
  });
  if (connection.channel !== "ig_comment") return empty("sin_config");
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const igUserId = String(cfg.ig_user_id ?? "");
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!igUserId || !enc) return empty("sin_config");
  let token: string;
  try {
    token = decrypt(enc);
  } catch {
    return empty("sin_config");
  }

  // Nuestro @usuario: junto con los ids de la cuenta es lo que distingue lo que
  // escribimos nosotros de lo que escribió el cliente. Si Graph ni siquiera nos
  // deja leerlo, no hay forma de decidir nada — mejor no tocar nada.
  const selfUsername = await fetchSelfUsername(igUserId, token);
  if (!selfUsername) return empty("graph_denegado");
  const selfIds = new Set(
    [igUserId, String(cfg.page_id ?? "")].filter(Boolean),
  );

  const postIds = await postsToScan(db, connection, igUserId, token);
  if (postIds.length === 0) return empty("sin_publicaciones");

  let ingestedInbound = 0;
  let ingested = 0;
  let seen = 0;
  let sinHilo = 0;
  let yaEstaba = 0;
  for (const postId of postIds) {
    const comments = await fetchCommentsWithReplies(postId, token);
    for (const comment of comments) {
      const parentId = comment.id;
      if (!parentId) continue;
      // El comentario de nivel superior: si es de un cliente y no está, entra.
      // Ya contestado por el comercio ⇒ historia, aunque sea reciente: nadie
      // tiene que responder dos veces lo mismo.
      const answered = (comment.replies?.data ?? []).some((r) =>
        isSelf(r, selfIds, selfUsername),
      );
      if (!isSelf(comment, selfIds, selfUsername)) {
        if (
          await ingestCustomerComment(db, connection, comment, postId, null, answered)
        ) {
          ingestedInbound++;
        }
      }
      for (const reply of comment.replies?.data ?? []) {
        if (!reply.id) continue;
        if (!isSelf(reply, selfIds, selfUsername)) {
          if (
            await ingestCustomerComment(db, connection, reply, postId, parentId, false)
          ) {
            ingestedInbound++;
          }
          continue;
        }
        seen++;
        const event = await buildSelfCommentEvent(db, {
          channel: "ig_comment",
          connection,
          commentId: reply.id,
          parentCommentId: parentId,
          postId,
          text: reply.text ?? "",
          receivedAt: parseIgTimestamp(reply.timestamp),
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
  }
  return {
    ingestedInbound,
    ingested,
    posts: postIds.length,
    seen,
    sinHilo,
    yaEstaba,
    reason: "ok",
  };
}

/** Corre el pull en todas las conexiones de comentarios de Instagram. */
export async function pullCommentsAll(db: SupabaseClient): Promise<{
  connections: number;
  ingestedInbound: number;
  ingested: number;
  seen: number;
  detail: Array<{ connection_id: string } & PullResult>;
}> {
  const { data: conns } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "ig_comment")
    .in("status", ["connected", "error", "expired"]);
  const list = (conns ?? []) as ChannelConnection[];

  let ingestedInbound = 0;
  let ingested = 0;
  let seen = 0;
  const detail: Array<{ connection_id: string } & PullResult> = [];
  for (const c of list) {
    try {
      const r = await pullCommentsForConnection(db, c);
      ingestedInbound += r.ingestedInbound;
      ingested += r.ingested;
      seen += r.seen;
      detail.push({ connection_id: c.id, ...r });
    } catch (err) {
      console.error("[comment-pull] conexión falló:", c.id, err);
    }
  }
  return { connections: list.length, ingestedInbound, ingested, seen, detail };
}

/** ¿Lo escribió la cuenta del comercio? Se mira el id (fiable) y, si Graph no
 *  lo devuelve, el @usuario. */
function isSelf(c: IgReply, selfIds: Set<string>, selfUsername: string): boolean {
  const fromId = c.from?.id;
  if (fromId) return selfIds.has(String(fromId));
  return (c.username ?? c.from?.username) === selfUsername;
}

/**
 * Un comentario de cliente que el webhook no trajo. Se arma igual que en el
 * adapter para que el corte de duplicados por id externo funcione idéntico.
 * Devuelve true sólo si la fila entró (no estaba antes).
 *
 * `alreadyAnswered` viene de las respuestas que el propio pull ya leyó: junto
 * con la antigüedad decide si esto todavía es algo a lo que contestar o si es
 * historia que sólo hay que dejar visible.
 */
async function ingestCustomerComment(
  db: SupabaseClient,
  connection: ChannelConnection,
  comment: IgReply,
  postId: string,
  parentCommentId: string | null,
  alreadyAnswered: boolean,
): Promise<boolean> {
  const commentId = comment.id;
  // Sin id de autor no hay a quién atribuirlo: crear un contacto fantasma sería
  // peor que dejarlo fuera (el hilo no podría responderse ni fusionarse).
  const authorId = comment.from?.id;
  if (!commentId || !authorId) return false;
  const username = (comment.from?.username ?? comment.username)?.trim();
  const receivedAt = parseIgTimestamp(comment.timestamp);
  // Un timestamp ilegible cae del lado seguro (NaN hace fallar el `<`): mejor
  // no contestar de más que contestar tarde.
  const age = Date.now() - Date.parse(receivedAt);
  const suppressAutoReply = alreadyAnswered || !(age < LIVE_WINDOW_MS);
  const written = await ingestInboundEvent(db, {
    channel: "ig_comment",
    connection,
    externalContactId: String(authorId),
    // "@usuario" — mismo formato que el webhook y el cron de nombres, para que
    // la misma persona se lea igual haya comentado o mandado un DM.
    contactName: username ? `@${username}` : undefined,
    externalMessageId: commentId,
    text: comment.text ?? "",
    comment: {
      postId,
      parentCommentId: parentCommentId ?? undefined,
    },
    receivedAt,
    suppressAutoReply,
  });
  return Boolean(written);
}

/**
 * Publicaciones a revisar: las recientes de la cuenta según Graph, más aquellas
 * donde ya hay comentarios guardados. La primera mitad cubre el post nuevo que
 * nunca tuvo comentarios en Riverz (invisible para la segunda); la segunda, el
 * post viejo que Graph ya no lista entre los recientes pero sigue recibiendo.
 */
async function postsToScan(
  db: SupabaseClient,
  connection: ChannelConnection,
  igUserId: string,
  token: string,
): Promise<string[]> {
  const ids = new Set<string>(await recentMediaIds(igUserId, token));
  for (const id of await postIdsWithSavedComments(db, connection)) {
    if (ids.size >= MAX_POSTS_PER_RUN) break;
    ids.add(id);
  }
  return [...ids].slice(0, MAX_POSTS_PER_RUN);
}

/** Publicaciones recientes de la cuenta, dentro de la ventana. */
async function recentMediaIds(igUserId: string, token: string): Promise<string[]> {
  const since = Date.now() - WINDOW_MS;
  const url = withAppsecretProof(
    `${GRAPH}/${igUserId}/media?fields=id,timestamp&limit=${MAX_POSTS_PER_RUN}` +
      `&access_token=${encodeURIComponent(token)}`,
    token,
  );
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{ id?: string; timestamp?: string }>;
    };
    return (json.data ?? [])
      .filter((m) => {
        if (!m.id) return false;
        const ms = Date.parse(parseIgTimestamp(m.timestamp));
        return !Number.isFinite(ms) || ms >= since;
      })
      .map((m) => String(m.id));
  } catch {
    return [];
  }
}

/** Publicaciones con comentarios recientes ya guardados en esta conexión. */
async function postIdsWithSavedComments(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<string[]> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: msgs } = await db
    .from("messages")
    .select("id, conversations!inner(connection_id)")
    .eq("channel", "ig_comment")
    .eq("conversations.connection_id", connection.id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(300);
  const messageIds = ((msgs ?? []) as Array<{ id: string }>).map((m) => m.id);
  if (messageIds.length === 0) return [];

  const { data: metas } = await db
    .from("comments_meta")
    .select("post_id")
    .in("message_id", messageIds);
  const seen = new Set<string>();
  for (const m of (metas ?? []) as Array<{ post_id: string | null }>) {
    if (m.post_id) seen.add(m.post_id);
    if (seen.size >= MAX_POSTS_PER_RUN) break;
  }
  return [...seen];
}

async function fetchSelfUsername(igUserId: string, token: string): Promise<string | null> {
  const url = withAppsecretProof(
    `${GRAPH}/${igUserId}?fields=username&access_token=${encodeURIComponent(token)}`,
    token,
  );
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { username?: string };
    return json.username?.trim() || null;
  } catch {
    return null;
  }
}

async function fetchCommentsWithReplies(postId: string, token: string): Promise<IgComment[]> {
  const fields =
    "id,text,timestamp,username,from{id,username}," +
    "replies{id,text,timestamp,username,from{id,username}}";
  const url = withAppsecretProof(
    `${GRAPH}/${postId}/comments?fields=${encodeURIComponent(fields)}&limit=${COMMENTS_PER_POST}` +
      `&access_token=${encodeURIComponent(token)}`,
    token,
  );
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: IgComment[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

/** Instagram devuelve "2026-07-27T12:00:00+0000" (sin dos puntos en el huso). */
function parseIgTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}
