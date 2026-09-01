import { supabaseAdmin } from "./admin-client";
import { ingestInboundEvent } from "./inbox-writer";
import { ingestMetaAttachment } from "./media-ingest";
import { appsecretProof, withAppsecretProof } from "./meta-graph";
import type { ChannelConnection, MessageAttachment } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";

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
  const r = await fetch(convUrl.toString());
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
  /** Páginas de 50 mensajes como máximo. */
  maxPages?: number;
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
  const desde = args.sinceIso ? new Date(args.sinceIso).getTime() : NaN;
  const hasta = args.untilIso ? new Date(args.untilIso).getTime() : NaN;
  const cutoffMs = Number.isFinite(desde)
    ? desde
    : windowDays > 0
      ? Date.now() - windowDays * 86_400_000
      : 0;
  const maxPages = args.maxPages ?? 4;
  const admin = supabaseAdmin();
  let fields = RICH_FIELDS;
  let url: string | null =
    `${GRAPH}/${args.threadId}/messages?fields=${fields}&limit=50&access_token=${encodeURIComponent(args.token)}`;
  let pages = 0;
  let ingested = 0;
  let reachedCutoff = false;

  while (url && pages < maxPages) {
    // `paging.next` no lleva el proof — se re-adjunta en cada página.
    let r: Response = await fetch(withAppsecretProof(url, args.token));
    // Un campo no soportado tumba la request entera: reintentamos una vez con
    // el juego mínimo para no perder el texto del hilo.
    if (!r.ok && fields === RICH_FIELDS && pages === 0) {
      fields = BASIC_FIELDS;
      url = `${GRAPH}/${args.threadId}/messages?fields=${fields}&limit=50&access_token=${encodeURIComponent(args.token)}`;
      r = await fetch(withAppsecretProof(url, args.token));
    }
    if (!r.ok) break;
    const j = (await r.json()) as { data?: GraphMessage[]; paging?: { next?: string } };

    for (const m of j.data ?? []) {
      // Newest-first: el primero fuera de la ventana implica que todo lo que
      // sigue también lo está.
      if (cutoffMs && m.created_time && new Date(m.created_time).getTime() < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      if (Number.isFinite(hasta) && m.created_time && new Date(m.created_time).getTime() > hasta) continue;
      if (!m.id) continue;
      const outbound = m.from?.id === args.selfId;
      const parsed = await mapGraphMessage(m, args.connection.workspace_id, args.externalId);
      // Nada que mostrar (Graph a veces devuelve el mensaje sin cuerpo ni
      // adjunto legible): mejor no dejar una burbuja en blanco en el hilo.
      if (!parsed.text && parsed.media.length === 0) continue;
      const guardado = await ingestInboundEvent(admin, {
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
        text: parsed.text,
        attachments: parsed.media.length ? parsed.media : undefined,
        receivedAt: m.created_time ?? new Date().toISOString(),
        outbound,
        historical: true,
        createIfMissing: args.createIfMissing,
        raw: { backfill: true },
      });
      // Sólo cuenta lo que ENTRÓ. `ingestInboundEvent` devuelve null cuando el
      // mensaje ya estaba (índice único por message_id), y contar igual hacía
      // que el barrido informara ~100 "ingested" por corrida releyendo la
      // misma historia: el número decía "el webhook pierde mensajes" cuando en
      // realidad no perdía ninguno.
      if (guardado) ingested++;
    }

    if (reachedCutoff) break;
    url = j.paging?.next ?? null;
    pages++;
  }
  return ingested;
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
    if (!url) {
      if (name) lines.push(name);
      continue;
    }
    const hinted = pick(imageData.url)
      ? ("image" as const)
      : pick(videoData.url)
        ? ("video" as const)
        : undefined;
    const ingested = await ingestMetaAttachment({
      attachmentUrl: url,
      workspaceId,
      conversationId: externalContactId,
      externalMessageId: m.id ? `${m.id}-${i}` : undefined,
      hintedKind: hinted,
    });
    if (ingested) {
      media.push({
        url: ingested.url,
        mime_type: ingested.mediaMime,
        size: ingested.mediaSize,
        name: name || undefined,
      });
    } else if (name) {
      lines.push(name);
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
