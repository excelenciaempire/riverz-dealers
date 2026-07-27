import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { buildSelfCommentEvent } from "./comment-echo";
import { ingestInboundEvent } from "./inbox-writer";

/**
 * Respuestas del comercio hechas DESDE Instagram — lado pull (RED DE SEGURIDAD).
 *
 * El camino normal es el webhook: **medido en producción el 2026-07-27,
 * Instagram SÍ notifica los comentarios de la cuenta dueña del post** (una
 * respuesta escrita en la app apareció en la bandeja 1 segundo después), igual
 * que Facebook con su webhook `feed`. Los adapters ya no los descartan, así
 * que en la práctica llegan solos y al instante.
 *
 * Este módulo existe para lo que el webhook pierda: una entrega que Meta no
 * reintente, una caída del servicio, un período con la conexión en error. Por
 * eso corre en el cron y no al revés — y por eso todo lo que trae pasa igual
 * por el corte de duplicados de `ingestInboundEvent`.
 *
 * Para no recorrer la cuenta entera, sólo mira las publicaciones donde ya hay
 * comentarios en la bandeja: una respuesta a un comentario que Riverz nunca
 * vio no tiene hilo a dónde ir de todos modos.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
/** Ventana de publicaciones a revisar — igual que la del reconciliador. */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Tope de publicaciones por corrida (la siguiente sigue, más nuevas primero). */
const MAX_POSTS_PER_RUN = 40;
/** Comentarios por publicación que pedimos a Graph. */
const COMMENTS_PER_POST = 50;

interface IgReply {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
}

interface IgComment extends IgReply {
  replies?: { data?: IgReply[] };
}

/**
 * Por qué una conexión no trajo nada. Sin esto, "0 respuestas" es ambiguo:
 * puede ser que no haya ninguna que sincronizar o que Meta nos esté negando
 * la lectura de comentarios (`instagram_manage_comments`) — dos situaciones
 * opuestas que se ven igual desde afuera.
 */
export type PullReason =
  | "ok"
  | "sin_config"
  | "graph_denegado"
  | "sin_publicaciones";

export interface PullResult {
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

/** Trae al inbox las respuestas propias que falten en UNA conexión de IG. */
export async function pullSelfRepliesForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<PullResult> {
  const empty = (reason: PullReason): PullResult => ({
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

  // Nuestro @usuario: es lo que Graph devuelve en cada comentario y la única
  // forma de distinguir lo que escribimos nosotros de lo que escribió el
  // cliente. Sin esto no se puede decidir nada — mejor no tocar nada.
  const selfUsername = await fetchSelfUsername(igUserId, token);
  if (!selfUsername) return empty("graph_denegado");

  const postIds = await recentPostIds(db, connection);
  if (postIds.length === 0) return empty("sin_publicaciones");

  let ingested = 0;
  let seen = 0;
  let sinHilo = 0;
  let yaEstaba = 0;
  for (const postId of postIds) {
    const comments = await fetchCommentsWithReplies(postId, token);
    for (const comment of comments) {
      const parentId = comment.id;
      if (!parentId) continue;
      for (const reply of comment.replies?.data ?? []) {
        if (!reply.id || reply.username !== selfUsername) continue;
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
  return { ingested, posts: postIds.length, seen, sinHilo, yaEstaba, reason: "ok" };
}

/** Corre el pull en todas las conexiones de comentarios de Instagram. */
export async function pullSelfRepliesAll(db: SupabaseClient): Promise<{
  connections: number;
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

  let ingested = 0;
  let seen = 0;
  const detail: Array<{ connection_id: string } & PullResult> = [];
  for (const c of list) {
    try {
      const r = await pullSelfRepliesForConnection(db, c);
      ingested += r.ingested;
      seen += r.seen;
      detail.push({ connection_id: c.id, ...r });
    } catch (err) {
      console.error("[comment-pull] conexión falló:", c.id, err);
    }
  }
  return { connections: list.length, ingested, seen, detail };
}

/** Publicaciones con comentarios recientes ya guardados en esta conexión. */
async function recentPostIds(
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
  const fields = "id,timestamp,username,replies{id,text,timestamp,username}";
  const url = withAppsecretProof(
    `${GRAPH}/${postId}/comments?fields=${fields}&limit=${COMMENTS_PER_POST}` +
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
