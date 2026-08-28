import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { buildSelfCommentEvent } from "./comment-echo";
import { ingestInboundEvent } from "./inbox-writer";

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

type CommentChannel = "ig_comment" | "fb_comment";

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
    edge: "media",
    timeField: "timestamp",
    // `hidden` en Instagram, `is_hidden` en Facebook: son campos distintos y
    // no se pueden intercambiar. Vienen desde la ingesta para que un
    // comentario que YA estaba oculto cuando lo trajimos no se vea visible
    // hasta que pase la conciliación, que corre cada diez minutos.
    commentFields:
      "id,text,timestamp,username,hidden,from{id,username}," +
      "replies{id,text,timestamp,username,hidden,from{id,username}}",
  },
  fb_comment: {
    edge: "posts",
    timeField: "created_time",
    commentFields:
      "id,message,created_time,is_hidden,from{id,name}," +
      "comments{id,message,created_time,is_hidden,from{id,name}}",
  },
};

/** ¿Vino oculto? Instagram lo llama `hidden` y Facebook `is_hidden`. */
function ocultoEn(c: RawComment): boolean {
  return c.hidden === true || c.is_hidden === true;
}

/** El texto del comentario, se llame `text` (Instagram) o `message` (Facebook). */
function textOf(c: RawComment): string {
  return c.text ?? c.message ?? "";
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
function contactNameOf(channel: CommentChannel, c: RawComment): string | undefined {
  if (channel === "fb_comment") return c.from?.name?.trim() || undefined;
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
  | "ok"
  | "sin_config"
  | "graph_denegado"
  | "sin_publicaciones";

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
}

/** Trae al inbox los comentarios que falten en UNA conexión. */
export async function pullCommentsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<PullResult> {
  const channel = connection.channel as CommentChannel;
  const isComment = channel === "ig_comment" || channel === "fb_comment";
  const empty = (reason: PullReason): PullResult => ({
    channel: isComment ? channel : null,
    ingestedInbound: 0,
    ingested: 0,
    posts: 0,
    seen: 0,
    sinHilo: 0,
    yaEstaba: 0,
    reason,
  });
  if (!isComment) return empty("sin_config");
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const igUserId = String(cfg.ig_user_id ?? "");
  const pageId = String(cfg.page_id ?? "");
  // Instagram cuelga los comentarios de la cuenta profesional; Facebook, de la
  // página.
  const target = channel === "ig_comment" ? igUserId : pageId;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!target || !enc) return empty("sin_config");
  let token: string;
  try {
    token = decrypt(enc);
  } catch {
    return empty("sin_config");
  }

  // Qué cuenta somos NOSOTROS. Por id siempre. En Instagram, además, por
  // @usuario: Graph no siempre devuelve `from` en los comentarios, y sin ese
  // dato no se puede distinguir lo nuestro de lo del cliente. Leerlo sirve
  // encima de sonda de permisos — si ni eso deja, mejor no tocar nada.
  const selfIds = new Set([igUserId, pageId].filter(Boolean));
  let selfUsername = "";
  if (channel === "ig_comment") {
    const u = await fetchSelfUsername(target, token);
    if (!u) return empty("graph_denegado");
    selfUsername = u;
  }

  const postIds = await postsToScan(db, connection, channel, target, token);
  if (postIds.length === 0) return empty("sin_publicaciones");

  let ingestedInbound = 0;
  let ingested = 0;
  let seen = 0;
  let sinHilo = 0;
  let yaEstaba = 0;
  for (const postId of postIds) {
    const comments = await fetchCommentsWithReplies(channel, postId, token);
    for (const comment of comments) {
      const parentId = comment.id;
      if (!parentId) continue;
      const replies = repliesOf(comment);
      // El comentario de nivel superior: si es de un cliente y no está, entra.
      // Ya contestado por el comercio ⇒ historia, aunque sea reciente: nadie
      // tiene que responder dos veces lo mismo.
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
          )
        ) {
          ingestedInbound++;
        }
      }
      for (const reply of replies) {
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
  }
  return {
    channel,
    ingestedInbound,
    ingested,
    posts: postIds.length,
    seen,
    sinHilo,
    yaEstaba,
    reason: "ok",
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
  const { data: conns } = await db
    .from("channel_connections")
    .select("*")
    .in("channel", ["ig_comment", "fb_comment"])
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
 *  lo devuelve, el @usuario de Instagram. */
function isSelf(c: RawComment, selfIds: Set<string>, selfUsername: string): boolean {
  const fromId = c.from?.id;
  if (fromId) return selfIds.has(String(fromId));
  return Boolean(selfUsername) && (c.username ?? c.from?.username) === selfUsername;
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
  channel: CommentChannel,
  comment: RawComment,
  postId: string,
  parentCommentId: string | null,
  alreadyAnswered: boolean,
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
  const suppressAutoReply = alreadyAnswered || !(age < LIVE_WINDOW_MS);
  const written = await ingestInboundEvent(db, {
    channel,
    connection,
    externalContactId: String(authorId),
    contactName: contactNameOf(channel, comment),
    externalMessageId: commentId,
    text: textOf(comment),
    comment: {
      postId,
      parentCommentId: parentCommentId ?? undefined,
    },
    receivedAt,
    suppressAutoReply,
  });
  // Ya venía oculto de la red. Sin anotarlo acá el comentario entra como
  // visible y se ve así hasta que pase la conciliación —diez minutos— justo
  // en el caso en que el comercio acaba de ocultarlo y viene a comprobar que
  // quedó bien.
  if (written && ocultoEn(comment)) {
    await db
      .from("messages")
      .update({
        is_hidden: true,
        hidden_by: "red",
        hidden_at: new Date().toISOString(),
      })
      .eq("message_id", commentId);
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
): Promise<string[]> {
  const ids = new Set<string>(await recentPostIds(channel, target, token));
  for (const id of await postIdsWithSavedComments(db, connection, channel)) {
    if (ids.size >= MAX_POSTS_PER_RUN) break;
    ids.add(id);
  }
  return [...ids].slice(0, MAX_POSTS_PER_RUN);
}

/** Publicaciones recientes de la cuenta, dentro de la ventana. */
async function recentPostIds(
  channel: CommentChannel,
  target: string,
  token: string,
): Promise<string[]> {
  const { edge, timeField } = DIALECT[channel];
  const since = Date.now() - WINDOW_MS;
  const url = withAppsecretProof(
    `${GRAPH}/${target}/${edge}?fields=id,${timeField}&limit=${MAX_POSTS_PER_RUN}` +
      `&access_token=${encodeURIComponent(token)}`,
    token,
  );
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: RawComment[] };
    return (json.data ?? [])
      .filter((m) => {
        if (!m.id) return false;
        const ms = Date.parse(parseMetaTimestamp(timeOf(m)));
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
  channel: CommentChannel,
): Promise<string[]> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: msgs } = await db
    .from("messages")
    .select("id, conversations!inner(connection_id)")
    .eq("channel", channel)
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

async function fetchCommentsWithReplies(
  channel: CommentChannel,
  postId: string,
  token: string,
): Promise<RawComment[]> {
  const url = withAppsecretProof(
    `${GRAPH}/${postId}/comments?fields=${encodeURIComponent(DIALECT[channel].commentFields)}` +
      `&limit=${COMMENTS_PER_POST}&access_token=${encodeURIComponent(token)}`,
    token,
  );
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: RawComment[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

/** Meta devuelve "2026-07-27T12:00:00+0000" (sin dos puntos en el huso). */
function parseMetaTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}
