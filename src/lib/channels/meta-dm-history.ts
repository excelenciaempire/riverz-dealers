import { supabaseAdmin } from "./admin-client";
import { ingestInboundEvent } from "./inbox-writer";
import { ingestMetaAttachment } from "./media-ingest";
import { appsecretProof, withAppsecretProof } from "./meta-graph";
import { fetchMetaGraph } from "./meta-fetch";
import type { ChannelConnection, MessageAttachment } from "@/types";
import { isMetaCommentContextNotice } from "./meta-comment-context";
import { MEDIA_UNAVAILABLE_LABEL, META_UNSUPPORTED_MEDIA_LABEL } from "./meta-attachments";
import { isMetaRateLimitedResponse, MetaRateLimitError } from "./meta-rate-limit";
import { repairStoredMetaMedia } from './repair-meta-media';

const GRAPH = "https://graph.facebook.com/v22.0";
/** Una página o mensaje de Graph no puede dejar un backfill colgado. */
const GRAPH_TIMEOUT_MS = 30_000;

/** Campos ricos de la Conversations API: además del texto, los adjuntos y los
 *  enlaces/posts compartidos. Si la versión de Graph rechaza alguno, se
 *  reintenta con el juego mínimo (mejor texto que nada). */
const RICH_FIELDS =
  "id,created_time,from,to,message,attachments{id,name,mime_type,size,image_data,video_data,file_url},shares{id,link,name,description}";
const BASIC_FIELDS = "id,created_time,from,message";

export type MetaPlatform = "messenger" | "instagram";

interface GraphMessage {
  id?: string;
  created_time?: string;
  from?: { id?: string; name?: string; username?: string };
  message?: string;
  attachments?: { data?: Array<Record<string, unknown>> };
  shares?: { data?: Array<Record<string, unknown>> };
}

/** Resuelve el id del hilo de la Página para una persona (PSID/IGSID). */
export async function resolveThreadId(
  token: string,
  pageId: string,
  platform: MetaPlatform,
  userId: string,
): Promise<string | null> {
  const convUrl = new URL(`${GRAPH}/${pageId}/conversations`);
  convUrl.searchParams.set("platform", platform);
  convUrl.searchParams.set("user_id", userId);
  convUrl.searchParams.set("access_token", token);
  const proof = appsecretProof(token);
  if (proof) convUrl.searchParams.set("appsecret_proof", proof);
  const r = await graphFetch(convUrl.toString());
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { id?: string }[] };
  return j.data?.[0]?.id ?? null;
}

export interface ThreadSyncArgs {
  token: string;
  /** Page id (messenger) o ig_user_id (instagram): con eso distinguimos qué
   *  mensajes son del comercio y cuáles del cliente. */
  selfId: string;
  connection: ChannelConnection;
  threadId: string;
  /** PSID / IGSID de la persona del hilo. */
  externalId: string;
  contactName?: string;
  /** true sólo para hilos nuevos que inició el comercio; false rellena huecos
   *  en hilos que ya existen (nunca revive una conversación borrada). */
  createIfMissing: boolean;
  /** Ventana hacia atrás. 0 = sin límite (hasta el tope de páginas). */
  windowDays?: number;
  /**
   * Piso absoluto (ISO). Manda sobre `windowDays`: se dejan de mirar mensajes
   * al cruzarlo. El barrido incremental lo usa para pedir SÓLO lo posterior a
   * la última pasada, en vez de releer los mismos 30 días cada dos horas.
   */
  sinceIso?: string;
  /** Techo inclusivo para importar sólo un rango de fechas. */
  untilIso?: string;
  /**
   * Sólo si el hilo EMPEZÓ en este rango, y entonces entra completo: desde su
   * primer mensaje hasta el último. Si empezó antes o después, no entra nada.
   * Manda sobre los demás cortes. Lo usa la importación manual.
   */
  startedBetween?: { sinceIso: string; untilIso: string };
  /** Páginas de 50 mensajes como máximo. */
  maxPages?: number;
  /** Persist only the opaque cursor, never an access token or provider URL. */
  after?: string;
  onCheckpoint?: (after: string | null) => Promise<void>;
  deadlineMs?: number;
}

/**
 * Trae el historial del hilo desde Meta y re-ingiere TODO lo que falte, en
 * ambos sentidos: lo que el comercio respondió desde la app de Messenger /
 * Instagram y lo que escribió el cliente (un webhook perdido, una caída, o
 * simplemente mensajes anteriores a la conexión). El índice único por
 * `message_id` hace que lo ya guardado no se duplique.
 *
 * Todo entra marcado como `historical`: rellena la conversación pero no
 * dispara la IA ni suma no-leídos — es historia, no algo nuevo por responder.
 *
 * Devuelve cuántos mensajes se guardaron DE VERDAD (los repetidos no cuentan).
 */
export async function syncThreadMessages(args: ThreadSyncArgs): Promise<number> {
  const windowDays = args.windowDays ?? 0;
  const inicio = args.startedBetween
    ? {
        desde: new Date(args.startedBetween.sinceIso).getTime(),
        hasta: new Date(args.startedBetween.untilIso).getTime(),
      }
    : null;
  const desde = args.sinceIso && !inicio ? new Date(args.sinceIso).getTime() : NaN;
  const hasta = args.untilIso && !inicio ? new Date(args.untilIso).getTime() : NaN;
  const cutoffMs = Number.isFinite(desde)
    ? desde
    : windowDays > 0 && !inicio
      ? Date.now() - windowDays * 86_400_000
      : 0;
  // Con `startedBetween` el hilo se junta entero antes de guardar nada: recién
  // al llegar a su primer mensaje se sabe si empezó en el rango.
  const juntados: GraphMessage[] = [];
  const maxPages = args.maxPages ?? 4;
  let fields = RICH_FIELDS;
  let url: string | null =
    `${GRAPH}/${args.threadId}/messages?fields=${fields}&limit=50&access_token=${encodeURIComponent(args.token)}`;
  let pages = 0;
  if (args.after) url += `&after=${encodeURIComponent(args.after)}`;
  let ingested = 0;
  let reachedCutoff = false;

  while (url && pages < maxPages) {
    if (args.deadlineMs && Date.now() >= args.deadlineMs) throw new Error('meta_thread_sync_pending');
    // `paging.next` no lleva el proof — se re-adjunta en cada página.
    let r: Response = await graphFetch(withAppsecretProof(url, args.token));
    // Un límite de uso no es un campo rechazado: reintentar con otro juego de
    // campos sólo estiraría el castigo. Se corta y el checkpoint ya guardado
    // retoma el hilo en la corrida siguiente.
    if (await isMetaRateLimitedResponse(r)) throw new MetaRateLimitError();
    // Un campo no soportado tumba la request entera: reintentamos una vez con
    // el juego mínimo para no perder el texto del hilo.
    if (!r.ok && fields === RICH_FIELDS && pages === 0) {
      fields = BASIC_FIELDS;
      url = `${GRAPH}/${args.threadId}/messages?fields=${fields}&limit=50&access_token=${encodeURIComponent(args.token)}`;
      if (args.after) url += `&after=${encodeURIComponent(args.after)}`;
      r = await graphFetch(withAppsecretProof(url, args.token));
      if (await isMetaRateLimitedResponse(r)) throw new MetaRateLimitError();
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`[meta] thread messages failed (${r.status}): ${detail.slice(0, 300)}`);
    }
    const j = (await r.json()) as { data?: GraphMessage[]; paging?: { next?: string } };

    for (const m of j.data ?? []) {
      if (inicio) {
        // Un mensaje anterior al rango: el hilo empezó antes y no entra.
        if (m.created_time && new Date(m.created_time).getTime() < inicio.desde) return 0;
        juntados.push(m);
        continue;
      }
      // Newest-first: el primero fuera de la ventana implica que todo lo que
      // sigue también lo está.
      if (cutoffMs && m.created_time && new Date(m.created_time).getTime() < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      if (Number.isFinite(hasta) && m.created_time && new Date(m.created_time).getTime() > hasta) continue;
      // Sólo cuenta lo que ENTRÓ. `ingestInboundEvent` devuelve null cuando el
      // mensaje ya estaba (índice único por message_id), y contar igual hacía
      // que el barrido informara ~100 "ingested" por corrida releyendo la
      // misma historia: el número decía "el webhook pierde mensajes" cuando en
      // realidad no perdía ninguno.
      if (await ingestGraphMessage(args, m)) ingested++;
    }

    if (reachedCutoff) {
      url = null;
      break;
    }
    url = j.paging?.next ?? null;
    if (args.onCheckpoint) {
      await args.onCheckpoint(url ? new URL(url).searchParams.get('after') : null);
    }
    pages++;
  }
  if (inicio) {
    // Sin llegar al primer mensaje no se sabe cuándo empezó: no entra.
    if (url) return 0;
    const primero = juntados[juntados.length - 1]?.created_time;
    if (!primero || new Date(primero).getTime() > inicio.hasta) return 0;
    // Del más viejo al más nuevo, así la conversación nace con su fecha real.
    for (const m of juntados.reverse()) {
      if (await ingestGraphMessage(args, m)) ingested++;
    }
    return ingested;
  }
  if (url && args.onCheckpoint) throw new Error('meta_thread_sync_pending');
  if (!url && args.onCheckpoint) await args.onCheckpoint(null);
  return ingested;
}

/** Guarda un mensaje de Graph en la bandeja. true si entró (no estaba). */
async function ingestGraphMessage(args: ThreadSyncArgs, m: GraphMessage): Promise<boolean> {
  if (!m.id) return false;
  const outbound = m.from?.id === args.selfId;
  const parsed = await mapGraphMessage(m, args.connection.workspace_id, args.externalId, args.token);
  if (outbound && isMetaCommentContextNotice(parsed.text)) return false;
  // Sin cuerpo ni archivo que bajar (la URL del CDN ya caducó, o Meta retiene
  // el contenido): antes se descartaba y el hilo quedaba con huecos. Entra con
  // un rótulo que la bandeja muestra localizado, así la conversación conserva
  // su orden y sus dos voces.
  const text = parsed.text || (parsed.media.length === 0 ? emptyGraphMessagePlaceholder(m) : "");
  if (!text && parsed.media.length === 0) return false;
  const guardado = await ingestInboundEvent(supabaseAdmin(), {
    channel: args.connection.channel,
    connection: args.connection,
    externalContactId: args.externalId,
    contactName: outbound
      ? args.contactName
      : (args.contactName ??
        (m.from?.username ? `@${m.from.username}` : undefined) ??
        m.from?.name ??
        undefined),
    externalMessageId: m.id,
    text,
    attachments: parsed.media.length ? parsed.media : undefined,
    receivedAt: m.created_time ?? new Date().toISOString(),
    outbound,
    historical: true,
    createIfMissing: args.createIfMissing,
    raw: { backfill: true },
  });
  if (!guardado && parsed.media.length) {
    return repairStoredMetaMedia(supabaseAdmin(), { workspaceId: args.connection.workspace_id,
      channel: args.connection.channel, externalMessageId: m.id, media: parsed.media, text: parsed.text });
  }
  return Boolean(guardado);
}

/**
 * Graph a veces deja conexiones abiertas sin cuerpo. El timeout convierte ese
 * caso en una recuperación parcial (sin perder lo ya escrito) y permite que la
 * siguiente corrida continúe desde los ids ya deduplicados.
 */
async function graphFetch(url: string): Promise<Response> {
  return fetchMetaGraph(url, {}, { timeoutMs: GRAPH_TIMEOUT_MS });
}

/**
 * Rótulo de un mensaje de Graph que no dejó ni texto ni archivo.
 *
 * - Traía adjunto o algo compartido que no se pudo bajar → `[Archivo no
 *   disponible]`: existió un archivo y ya no se puede recuperar.
 * - No traía nada → `[unsupported media]`: Meta devuelve el mensaje vacío
 *   cuando retiene el contenido (el ver-una-vez, y lo que marca
 *   `is_unsupported`: notas de voz de IG, GIF, contenido de cuentas
 *   privadas); la burbuja dice que hay que abrirlo en la app.
 *
 * Sin fecha o sin autor no es un mensaje que Graph haya entregado de verdad
 * (a veces devuelve el id pelado): guardarlo inventaría una burbuja fechada
 * hoy y atribuida al cliente, así que se sigue descartando.
 */
export function emptyGraphMessagePlaceholder(m: {
  created_time?: string;
  from?: { id?: string };
  attachments?: { data?: unknown[] };
  shares?: { data?: unknown[] };
}): string {
  if (!m.created_time || !m.from?.id) return "";
  const traiaArchivo =
    (m.attachments?.data?.length ?? 0) > 0 || (m.shares?.data?.length ?? 0) > 0;
  return traiaArchivo ? MEDIA_UNAVAILABLE_LABEL : META_UNSUPPORTED_MEDIA_LABEL;
}

/**
 * Traduce un mensaje de la Conversations API al par (texto, adjuntos) que
 * guarda la bandeja. Las URL de Graph caducan, así que cada archivo se
 * re-hospeda en Storage; los enlaces/posts compartidos quedan como texto.
 */
async function mapGraphMessage(
  m: GraphMessage,
  workspaceId: string,
  externalContactId: string,
  accessToken: string,
): Promise<{ text: string; media: MessageAttachment[] }> {
  const media: MessageAttachment[] = [];
  const lines: string[] = [];
  const base = String(m.message ?? "").trim();
  if (base) lines.push(base);

  const attachments = m.attachments?.data ?? [];
  for (let i = 0; i < attachments.length; i++) {
    const a = (attachments[i] ?? {}) as Record<string, unknown>;
    const imageData = (a.image_data ?? {}) as { url?: unknown };
    const videoData = (a.video_data ?? {}) as { url?: unknown };
    const url =
      pick(imageData.url) || pick(videoData.url) || pick(a.file_url) || "";
    const name = pick(a.name);
    // Un archivo que no se puede bajar igual deja constancia: sin la línea, un
    // "mira esto" quedaba sin lo que mostraba y el agente no sabía que hubo
    // algo más. Mismo rótulo que usa el webhook (meta-attachments).
    if (!url) {
      lines.push(name || MEDIA_UNAVAILABLE_LABEL);
      continue;
    }
    const hinted = pick(imageData.url)
      ? ("image" as const)
      : pick(videoData.url)
        ? ("video" as const)
        : undefined;
    // Con el token y el `mid`, una URL del CDN que ya no sirve se reintenta
    // autenticada y, si hace falta, pidiéndole a Graph una fresca: en un hilo
    // de meses atrás es lo normal, no la excepción.
    const ingested = await ingestMetaAttachment({
      attachmentUrl: url,
      workspaceId,
      conversationId: externalContactId,
      externalMessageId: m.id ? `${m.id}-${i}` : undefined,
      hintedKind: hinted,
      accessToken,
      mid: m.id,
      attachmentIndex: i,
    });
    if (ingested) {
      media.push({
        url: ingested.url,
        mime_type: ingested.mediaMime,
        size: ingested.mediaSize,
        name: name || undefined,
      });
    } else {
      lines.push(name || MEDIA_UNAVAILABLE_LABEL);
    }
  }

  for (const rawShare of m.shares?.data ?? []) {
    const s = (rawShare ?? {}) as Record<string, unknown>;
    const title = pick(s.name) || pick(s.description);
    const link = pick(s.link);
    const line = title && link ? `${title}\n${link}` : title || link;
    if (line) lines.push(line);
  }

  return { text: [...new Set(lines)].join("\n"), media };
}

function pick(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}
