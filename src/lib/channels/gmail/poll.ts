import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection, MessageAttachment } from "@/types";
import type { InboundEvent } from "../types";
import { ingestInboundEvent } from "../inbox-writer";
import {
  ingestRawMedia,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "../media-ingest";
import { decrypt, encrypt } from "../encryption";
import { supabaseAdmin } from "../admin-client";
import { listConnections } from "../connections";
import { savePollState } from "../poll-state";
import { recoveredEvent } from '../recovered-event';
import { htmlToText } from "../html-to-text";
import { findMessageByExternalId } from "../message-lookup";
import { detectAutomatedSender } from "../email/automated-sender";
import {
  destinatarioCliente,
  direccionesDeCorreo,
  direccionesPropias,
} from "../email/direcciones";
import { FallaTransitoria, pedirAlProveedor } from "../email/falla-transitoria";
import { estadoDeHistorial, planDeHistorial } from "../email/historial";
import { mapWithConcurrency } from "@/lib/async/concurrency";

/**
 * Gmail does not push inbound mail without a Pub/Sub topic. To avoid
 * forcing Cloud Pub/Sub setup on every workspace, the unified inbox
 * polls each connected mailbox via `users.messages.list` and ingests
 * anything not already in `messages` (dedup is the unique index on
 * `messages.message_id`).
 *
 * Dos recorridos por corrida, cada uno con su cursor de página:
 *   - en vivo: la ventana desde la última pasada completa (1 día en el ritmo
 *     normal, más si hubo una caída);
 *   - historial: los 90 días previos a la conexión, una sola vez por buzón
 *     (ver `email/historial.ts`), un tramo por corrida.
 *
 * Los dos miran TODO el correo menos spam, papelera, borradores y chats. Antes
 * era `in:inbox` + `in:sent`: un hilo que el comercio archivó después de
 * contestar no entraba nunca, y justo esas son las conversaciones completas.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CONNECTION_CONCURRENCY = 3;
const DIA_MS = 86_400_000;
/** Ids por corrida del recorrido en vivo. */
const TOPE_EN_VIVO = 100;
/** Ids por corrida del historial: se suma al vivo, así que va más corto. */
const TOPE_HISTORIAL = 40;
/**
 * Cuánto se deja descansar un buzón que agotó la cuota de Gmail. Sin pausa, la
 * corrida siguiente (2 minutos después) volvía a gastar la cuota que se estaba
 * recuperando y el buzón quedaba trabado: 72 corridas seguidas fallando.
 */
const PAUSA_POR_CUOTA_MS = 10 * 60_000;

/** Lo que no es una conversación con un cliente. */
export const FILTRO_DE_CONVERSACIONES = "-in:spam -in:trash -in:draft -in:chats";

/** Claves del recorrido anterior (bandeja + enviados por separado). */
const CLAVES_LEGADAS = [
  "gmail_sync_query",
  "gmail_inbox_next",
  "gmail_sent_next",
  "gmail_inbox_done",
  "gmail_sent_done",
];

interface PollSummary {
  connectionId: string;
  email: string;
  ingested: number;
  error?: string;
}

export async function pollAllGmailConnections(): Promise<PollSummary[]> {
  const admin = supabaseAdmin();
  // error/expired incluidos: el token se refresca solo y sana la fila. Mirando
  // sólo 'connected', un buzón que falló una vez dejaba de recorrerse para
  // siempre y no volvía sin que alguien reconectara a mano.
  const connections = await listConnections(admin, { channel: "gmail" });
  if (connections.length === 0) return [];

  return mapWithConcurrency(connections, CONNECTION_CONCURRENCY, async (c) => {
    const email = String(
      (c.config ?? {}).email ?? c.external_account_id ?? c.label ?? "",
    );
    const pausa = Date.parse(String((c.config ?? {}).gmail_pausa_hasta ?? ''));
    if (Number.isFinite(pausa) && pausa > Date.now()) {
      return { connectionId: c.id, email, ingested: 0 };
    }
    try {
      const ingested = await pollOne(admin, c);
      return { connectionId: c.id, email, ingested };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof FallaTransitoria && err.status === 429) {
        // Cuota agotada: se pausa el buzón y no se cuenta como caída.
        const { data: fila } = await admin.from("channel_connections").select("config").eq("id", c.id).maybeSingle();
        await admin
          .from("channel_connections")
          .update({
            config: {
              ...((fila?.config ?? {}) as Record<string, unknown>),
              gmail_pausa_hasta: new Date(Date.now() + PAUSA_POR_CUOTA_MS).toISOString(),
            },
          })
          .eq("id", c.id);
        return { connectionId: c.id, email, ingested: 0 };
      }
      await admin
        .from("channel_connections")
        .update({ last_error: msg.slice(0, 500) })
        .eq("id", c.id);
      return { connectionId: c.id, email, ingested: 0, error: msg };
    }
  });
}

/** La consulta de un tramo: [desde, hasta) si hay `hasta`, si no desde en adelante. */
export function consultaGmail(desdeMs: number, hastaMs?: number): string {
  const tramo = [`after:${Math.floor(desdeMs / 1000)}`];
  if (hastaMs != null) tramo.push(`before:${Math.ceil(hastaMs / 1000)}`);
  return `${FILTRO_DE_CONVERSACIONES} ${tramo.join(" ")}`;
}

export async function pollOne(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<number> {
  const accessToken = await getFreshAccessToken(admin, connection);
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const lastHistoryId = cfg.history_id ? String(cfg.history_id) : "";
  const ahora = Date.now();
  const historial = planDeHistorial(cfg, ahora);

  // En vivo. La referencia es la última pasada completa del POLL (el push ya
  // no la toca: antes la pisaba y encogía la primera lectura a un día). Un
  // buzón recién conectado arranca en el corte del historial.
  const referencia =
    connection.last_synced_at ??
    (historial.pendiente ? new Date(historial.hastaMs).toISOString() : null);
  const consultaViva = String(
    cfg.gmail_live_query ??
      consultaGmail(ahora - diasDeVentana(referencia, ahora) * DIA_MS),
  );
  const vivo = await listMessageIdsViaQuery(
    accessToken,
    consultaViva,
    String(cfg.gmail_live_next ?? ""),
    TOPE_EN_VIVO,
  );
  const vivoCompleto = !vivo.next;

  // Historial: el tramo congelado, un bloque por corrida.
  const pasado = historial.pendiente
    ? await listMessageIdsViaQuery(
        accessToken,
        consultaGmail(historial.desdeMs, historial.hastaMs),
        String(cfg.gmail_backfill_next ?? ""),
        TOPE_HISTORIAL,
      )
    : { ids: [], next: "" };
  const historialCompleto = historial.pendiente && !pasado.next;

  let ingested = 0;
  let maxHistoryId = lastHistoryId ? BigInt(lastHistoryId) : BigInt(0);
  for (const id of new Set([...vivo.ids, ...pasado.ids])) {
    // Un 429/5xx corta acá, antes de guardar los cursores: la próxima corrida
    // repite el tramo y lo ya guardado se saltea por id.
    const r = await ingestGmailMessage(admin, connection, accessToken, id);
    if (r.historyId) {
      const h = BigInt(r.historyId);
      if (h > maxHistoryId) maxHistoryId = h;
    }
    if (r.ingested) ingested++;
  }

  const legado = Object.fromEntries(
    CLAVES_LEGADAS.filter((k) => cfg[k] != null).map((k) => [k, null]),
  );
  await savePollState(
    admin,
    connection.id,
    {
      ...legado,
      gmail_live_query: vivoCompleto ? null : consultaViva,
      gmail_live_next: vivo.next || null,
      gmail_backfill_next: pasado.next || null,
      ...estadoDeHistorial(historial, historialCompleto, ["gmail_backfill_next"]),
      poll_sync_complete: vivoCompleto && (!historial.pendiente || historialCompleto),
      ...(maxHistoryId > BigInt(0) ? { history_id: maxHistoryId.toString() } : {}),
    },
    null,
    { complete: vivoCompleto },
  );
  return ingested;
}

async function getFreshAccessToken(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<string> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encAccess = String(secrets.access_token ?? "");
  const encRefresh = String(secrets.refresh_token ?? "");
  if (!encAccess) throw new Error("connection missing access_token");

  const expiresAt = secrets.access_token_expires_at
    ? new Date(String(secrets.access_token_expires_at)).getTime()
    : 0;
  const stillValid = expiresAt && expiresAt - 60_000 > Date.now();
  if (stillValid) return decrypt(encAccess);

  if (!encRefresh) {
    // No refresh token — use the existing one and let the call 401 if dead.
    return decrypt(encAccess);
  }

  const refreshToken = decrypt(encRefresh);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET missing — cannot refresh");
  }
  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`refresh failed (${r.status}): ${detail}`);
  }
  const json = (await r.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const fresh = json.access_token;
  if (!fresh) throw new Error("refresh response missing access_token");

  const newSecrets = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(json.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}

async function listMessageIdsViaQuery(
  accessToken: string,
  q: string,
  initialPage = '',
  tope = TOPE_EN_VIVO,
): Promise<{ ids: string[]; next: string }> {
  // Paginamos siguiendo nextPageToken hasta el tope: antes maxResults=50 sin
  // paginar descartaba todo lo que excediera 50 por consulta y corrida.
  const ids: string[] = [];
  let pageToken = initialPage;
  while (ids.length < tope) {
    const u = new URL(`${GMAIL_API}/users/me/messages`);
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", String(Math.min(100, tope - ids.length)));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await pedirAlProveedor(
      u,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "messages.list",
    );
    if (r.status === 400 && pageToken && pageToken === initialPage) {
      // Un token de página guardado que Gmail ya no acepta (el cron estuvo
      // parado) trababa el recorrido para siempre: se rearranca el tramo.
      pageToken = "";
      continue;
    }
    if (!r.ok) throw new Error(`messages.list ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of j.messages ?? []) ids.push(m.id);
    pageToken = j.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return { ids, next: pageToken };
}

interface GmailMessage {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPayload;
}

interface GmailPayload {
  headers?: { name: string; value: string }[];
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
}

/** El mensaje completo, o null si ya no existe. 429/5xx lanzan. */
async function fetchMessage(
  accessToken: string,
  id: string,
): Promise<GmailMessage | null> {
  const u = new URL(`${GMAIL_API}/users/me/messages/${id}`);
  u.searchParams.set("format", "full");
  const r = await pedirAlProveedor(
    u,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "messages.get",
  );
  // Borrado entre el listado y la lectura: no hay nada que reintentar.
  if (r.status === 404) return null;
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`messages.get ${r.status}: ${detail.slice(0, 300)}`);
  }
  return (await r.json()) as GmailMessage;
}

function header(
  headers: { name: string; value: string }[],
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === target)?.value;
}

export type SentidoGmail = "entrante" | "saliente";

/**
 * ¿Lo escribió el cliente o el comercio? Enviado es la etiqueta SENT o un
 * remitente que es el propio buzón. Spam, papelera, borradores y chats no son
 * conversación (la consulta ya los excluye; esto es la segunda barrera).
 */
export function sentidoGmail(
  labels: string[],
  from: string,
  propias: Set<string>,
): SentidoGmail | null {
  if (labels.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH" || l === "CHAT")) {
    return null;
  }
  if (labels.includes("SENT")) return "saliente";
  const remitente = direccionesDeCorreo(from)[0]?.email;
  if (remitente && propias.has(remitente)) return "saliente";
  return "entrante";
}

/**
 * Trae un mensaje de Gmail y lo guarda en la bandeja. Lo comparten el poll y
 * el push, así los dos bajan adjuntos igual y los dos se saltean lo ya
 * guardado ANTES de bajar nada (antes cada pasada de la ventana de un día
 * volvía a bajar todos los adjuntos del día).
 */
export async function ingestGmailMessage(
  admin: SupabaseClient,
  connection: ChannelConnection,
  accessToken: string,
  id: string,
  opciones: { enVivo?: boolean } = {},
): Promise<{ ingested: boolean; historyId?: string }> {
  const msg = await fetchMessage(accessToken, id);
  if (!msg) return { ingested: false };
  const historyId = msg.historyId;
  const headers = msg.payload?.headers ?? [];
  const sentido = sentidoGmail(
    msg.labelIds ?? [],
    header(headers, "From") ?? "",
    direccionesPropias(connection),
  );
  if (!sentido) return { ingested: false, historyId };

  // Mismas claves que usa cada builder: el enviado por el id de Gmail (el que
  // guarda la ruta de envío), el recibido por su Message-ID.
  const externalMessageId =
    sentido === "saliente" ? msg.id : header(headers, "Message-ID") || msg.id;
  const existente = await findMessageByExternalId(admin, {
    workspaceId: connection.workspace_id,
    channel: "gmail",
    externalMessageId,
  });
  if (existente) return { ingested: false, historyId };

  const event =
    sentido === "saliente"
      ? await buildOutboundEvent(connection, msg, accessToken)
      : await buildInboundEvent(connection, msg, accessToken);
  if (!event) return { ingested: false, historyId };
  const result = await ingestInboundEvent(
    admin,
    event.outbound || opciones.enVivo ? event : recoveredEvent(event),
  );
  return { ingested: Boolean(result), historyId };
}

async function buildInboundEvent(
  connection: ChannelConnection,
  msg: GmailMessage,
  accessToken: string,
): Promise<InboundEvent | null> {
  const headers = msg.payload?.headers ?? [];
  const from = header(headers, "From") ?? "";
  const subject = header(headers, "Subject") ?? "";
  const messageIdHeader = header(headers, "Message-ID");
  const remitente = direccionesDeCorreo(from)[0];
  if (!remitente) return null;
  const { email, name } = remitente;

  const labels = msg.labelIds ?? [];
  const { text, html } = extractBody(msg.payload);
  const receivedAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date().toISOString();

  // Download any file attachments (photos, PDFs, …) the customer emailed
  // to Storage so the inbox can show them. Keyed by sender email since
  // the conversation row doesn't exist yet at this point.
  const refs = collectGmailAttachments(msg.payload);
  const attachments = refs.length
    ? await fetchGmailAttachments(
        accessToken,
        msg.id,
        refs,
        connection.workspace_id,
        email,
      )
    : [];

  // Mismo portero que en Outlook: rebotes, autorespuestas y boletines se
  // guardan y se ven, pero no despiertan al agente.
  const machine = detectAutomatedSender({
    from,
    subject,
    headers,
    contentType: msg.payload?.mimeType,
  });
  if (machine.automated) {
    console.info(
      `[gmail-poll] remitente automático (${machine.reason}), no se responde solo: ${email}`,
    );
  }

  return {
    channel: "gmail",
    connection,
    externalContactId: email,
    contactName: name || undefined,
    suppressAutoReply: machine.automated || undefined,
    externalMessageId: messageIdHeader || msg.id,
    externalThreadId: msg.threadId,
    subject,
    text: text || htmlToText(html) || "",
    htmlBody: html || undefined,
    receivedAt,
    attachments: attachments.length ? attachments : undefined,
    raw: { gmailId: msg.id, labels },
  };
}

interface GmailAttachmentRef {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** Walk the MIME tree for parts that are real file attachments (have a
 *  filename + a fetchable attachmentId). */
export function collectGmailAttachments(
  payload?: GmailPayload,
): GmailAttachmentRef[] {
  const out: GmailAttachmentRef[] = [];
  const walk = (p?: GmailPayload) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      out.push({
        attachmentId: p.body.attachmentId,
        filename: p.filename,
        mimeType: p.mimeType || "application/octet-stream",
        size: p.body.size ?? 0,
      });
    }
    for (const part of p.parts ?? []) walk(part);
  };
  walk(payload);
  return out;
}

/** Download each Gmail attachment (base64url) and re-host in Storage.
 *  Un adjunto roto se saltea; un 429/5xx o una caída de red LANZA: si no, el
 *  correo quedaba guardado sin su archivo y, como ya existe, no se repetía. */
export async function fetchGmailAttachments(
  accessToken: string,
  gmailMessageId: string,
  refs: GmailAttachmentRef[],
  workspaceId: string,
  convKey: string,
): Promise<MessageAttachment[]> {
  const out: MessageAttachment[] = [];
  for (const ref of refs) {
    if (out.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
    // Descartar por tamaño declarado ANTES de descargar/decodificar.
    if (ref.size && ref.size > MAX_ATTACHMENT_BYTES) continue;
    try {
      const r = await pedirAlProveedor(
        `${GMAIL_API}/users/me/messages/${gmailMessageId}/attachments/${ref.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "attachments.get",
      );
      if (!r.ok) continue;
      const j = (await r.json()) as { data?: string; size?: number };
      if (!j.data) continue;
      // base64url -> bytes ~ length * 0.75: descartar sin decodificar si excede.
      if (j.data.length * 0.75 > MAX_ATTACHMENT_BYTES) continue;
      const buffer = Buffer.from(
        j.data.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      );
      const ingested = await ingestRawMedia({
        buffer,
        mime: ref.mimeType,
        workspaceId,
        conversationId: convKey,
        id: `${gmailMessageId}-${ref.attachmentId}`.slice(0, 120),
        fileName: ref.filename,
      });
      if (!ingested) continue;
      out.push({
        url: ingested.url,
        mime_type: ingested.mediaMime,
        name: ref.filename,
        size: ingested.mediaSize,
      });
    } catch (err) {
      if (err instanceof FallaTransitoria) throw err;
      /* skip this attachment */
    }
  }
  return out;
}

async function buildOutboundEvent(
  connection: ChannelConnection,
  msg: GmailMessage,
  accessToken: string,
): Promise<InboundEvent | null> {
  const headers = msg.payload?.headers ?? [];

  // A sent message is addressed TO the customer — that's who the
  // conversation belongs to: the first To/Cc that isn't the mailbox itself.
  const cliente = destinatarioCliente(
    [header(headers, "To"), header(headers, "Cc")],
    direccionesPropias(connection),
  );
  if (!cliente) return null;
  const { email, name } = cliente;

  const subject = header(headers, "Subject") ?? "";
  const { text, html } = extractBody(msg.payload);
  // Los adjuntos de una respuesta enviada desde el celular/Gmail también se
  // re-hostean (mismo camino que el entrante), para que en Riverz se vea el
  // archivo y no solo el texto.
  const refs = collectGmailAttachments(msg.payload);
  const attachments = refs.length
    ? await fetchGmailAttachments(
        accessToken,
        msg.id,
        refs,
        connection.workspace_id,
        email,
      )
    : [];
  return {
    channel: "gmail",
    connection,
    externalContactId: email,
    contactName: name || undefined,
    // Key on the Gmail message id — the send route stores this same id,
    // so a reply sent through the app dedupes against its Sent copy.
    externalMessageId: msg.id,
    externalThreadId: msg.threadId,
    subject,
    text: text || htmlToText(html) || "",
    htmlBody: html || undefined,
    receivedAt: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
    outbound: true,
    attachments: attachments.length ? attachments : undefined,
    raw: { gmailId: msg.id, sent: true },
  };
}

function extractBody(payload?: GmailPayload): { text: string; html: string } {
  if (!payload) return { text: "", html: "" };
  let text = "";
  let html = "";
  const walk = (p: GmailPayload) => {
    if (p.mimeType === "text/plain" && p.body?.data) {
      text ||= decodeBody(p.body.data);
    } else if (p.mimeType === "text/html" && p.body?.data) {
      html ||= decodeBody(p.body.data);
    }
    for (const part of p.parts ?? []) walk(part);
  };
  walk(payload);
  return { text, html };
}

function decodeBody(data: string): string {
  // Gmail uses URL-safe base64 without padding.
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 ? padded + "=".repeat(4 - (padded.length % 4)) : padded;
  return Buffer.from(pad, "base64").toString("utf8");
}

/**
 * Cuántos días hacia atrás mira el recorrido en vivo.
 *
 * Era `newer_than:1d` fijo, y ese "1d" era una apuesta a que el recorrido no
 * falla nunca. Una caída de más de 24 horas —el servicio caído, el buzón en
 * error, la conexión sin token— hacía que el correo de esas horas quedara
 * afuera para siempre: nada lo volvía a pedir, porque la siguiente corrida
 * también miraba un solo día.
 *
 * Ahora la ventana sale de cuándo se recorrió por última vez, redondeada hacia
 * arriba y con un día de gracia por si los relojes no coinciden. Se topea en 30
 * días: más atrás Gmail se pone lento y ese correo ya lo atendió una persona.
 *
 * Sin referencia, 7 días. Un buzón recién conectado no llega acá sin ella: su
 * referencia es el corte del historial, que trae los 90 días previos aparte.
 */
export function diasDeVentana(
  lastSyncedAt: string | null | undefined,
  ahora = Date.now(),
): number {
  if (!lastSyncedAt) return 7;
  const desde = Date.parse(lastSyncedAt);
  if (!Number.isFinite(desde)) return 1;
  const hueco = ahora - desde;
  const dias = Math.max(1, Math.ceil(hueco / DIA_MS));
  // El día de gracia sólo cuando de verdad hubo un hueco: en el ritmo normal
  // —cada pocos minutos— pedir dos días sería traer el doble por nada.
  const gracia = hueco > DIA_MS ? 1 : 0;
  return Math.min(dias + gracia, 30);
}

/** La misma ventana en la sintaxis de búsqueda de Gmail. */
export function ventanaDeBusqueda(
  lastSyncedAt: string | null | undefined,
): string {
  return `newer_than:${diasDeVentana(lastSyncedAt)}d`;
}
