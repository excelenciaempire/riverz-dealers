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
import { htmlToText } from "../html-to-text";
import { detectAutomatedSender } from "../email/automated-sender";
import { mapWithConcurrency } from "@/lib/async/concurrency";

/**
 * Gmail does not push inbound mail without a Pub/Sub topic. To avoid
 * forcing Cloud Pub/Sub setup on every workspace, the unified inbox
 * polls each connected mailbox via `users.messages.list` and ingests
 * anything not already in `messages` (dedup is the unique index on
 * `messages.message_id`).
 *
 * Cursor is `config.history_id`, refreshed each run from the newest
 * message's historyId. First poll falls back to `q=newer_than:1d` so a
 * freshly connected account picks up the last day of mail.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CONNECTION_CONCURRENCY = 3;

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
    try {
      const ingested = await pollOne(admin, c);
      return { connectionId: c.id, email, ingested };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin
        .from("channel_connections")
        .update({ last_error: msg.slice(0, 500) })
        .eq("id", c.id);
      return { connectionId: c.id, email, ingested: 0, error: msg };
    }
  });
}

async function pollOne(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<number> {
  const accessToken = await getFreshAccessToken(admin, connection);
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const lastHistoryId = cfg.history_id ? String(cfg.history_id) : "";

  // messages.list every run with a sliding 1-day window. The unique
  // index on messages.message_id makes re-ingest a no-op, so overlap
  // is free — and this avoids the history.list edge cases (cursor too
  // old, label filter mismatches) that silently returned 0 even when
  // the inbox had fresh mail.
  //
  // On a freshly-connected mailbox we widen to 7d so the user sees a
  // realistic backlog instead of an empty inbox on day one. Gate on
  // last_synced_at (has the POLLER ever run?) — NOT on history_id, which
  // startGmailWatch writes at connect time, so keying on it defeated the 7d
  // backlog on the very first poll.
  const window = ventanaDeBusqueda(connection.last_synced_at);
  const inboxIds = await listMessageIdsViaQuery(
    accessToken,
    `in:inbox ${window}`,
  );
  // Also pull recently-sent mail so the agent's own replies (including
  // ones sent straight from Gmail, outside this app) show in the thread.
  const sentIds = await listMessageIdsViaQuery(
    accessToken,
    `in:sent ${window}`,
  );

  if (inboxIds.length === 0 && sentIds.length === 0) {
    await savePollState(admin, connection.id, {});
    return 0;
  }

  let ingested = 0;
  let maxHistoryId = lastHistoryId ? BigInt(lastHistoryId) : BigInt(0);
  for (const id of inboxIds) {
    const msg = await fetchMessage(accessToken, id);
    if (!msg) continue;
    if (msg.historyId) {
      const h = BigInt(msg.historyId);
      if (h > maxHistoryId) maxHistoryId = h;
    }
    const event = await buildInboundEvent(connection, msg, accessToken);
    if (!event) continue;
    const result = await ingestInboundEvent(admin, event);
    if (result) ingested++;
  }
  for (const id of sentIds) {
    const msg = await fetchMessage(accessToken, id);
    if (!msg) continue;
    // El cursor debe avanzar también con los enviados, no solo con la bandeja.
    if (msg.historyId) {
      const h = BigInt(msg.historyId);
      if (h > maxHistoryId) maxHistoryId = h;
    }
    const event = await buildOutboundEvent(connection, msg, accessToken);
    if (!event) continue;
    const result = await ingestInboundEvent(admin, event);
    if (result) ingested++;
  }

  await savePollState(admin, connection.id, { history_id: maxHistoryId.toString() });
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
): Promise<string[]> {
  // Paginamos siguiendo nextPageToken hasta un tope prudente: antes
  // maxResults=50 sin paginar descartaba todo lo que excediera 50 por
  // consulta y corrida (se perdían entrantes y salientes en buzones activos).
  const CAP = 250;
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < CAP) {
    const u = new URL(`${GMAIL_API}/users/me/messages`);
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`messages.list ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of j.messages ?? []) ids.push(m.id);
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return ids;
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

async function fetchMessage(
  accessToken: string,
  id: string,
): Promise<GmailMessage | null> {
  const u = new URL(`${GMAIL_API}/users/me/messages/${id}`);
  u.searchParams.set("format", "full");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as GmailMessage;
}

async function buildInboundEvent(
  connection: ChannelConnection,
  msg: GmailMessage,
  accessToken: string,
): Promise<InboundEvent | null> {
  const headers = msg.payload?.headers ?? [];
  const getH = (name: string): string | undefined =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const from = getH("From") ?? "";
  const subject = getH("Subject") ?? "";
  const messageIdHeader = getH("Message-ID") ?? getH("Message-Id");
  const { email, name } = parseAddress(from);
  if (!email) return null;

  // Skip mail we sent ourselves (label SENT, no INBOX).
  const labels = msg.labelIds ?? [];
  if (labels.includes("SENT") && !labels.includes("INBOX")) return null;

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
 *  Best-effort per file — a failed one is skipped, not fatal. */
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
      const r = await fetch(
        `${GMAIL_API}/users/me/messages/${gmailMessageId}/attachments/${ref.attachmentId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
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
    } catch {
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
  const getH = (name: string): string | undefined =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  // A sent message is addressed TO the customer — that's who the
  // conversation belongs to. Take the first To recipient.
  const toRaw = getH("To") ?? "";
  const firstTo = toRaw.split(",")[0] ?? "";
  const { email, name } = parseAddress(firstTo);
  if (!email) return null;

  const subject = getH("Subject") ?? "";
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

function parseAddress(raw: string): { email: string; name: string } {
  // "John Doe <john@example.com>" or just "john@example.com"
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ""), email: m[2].toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
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
 * Hasta dónde hacia atrás se pide el correo.
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
 * Sin `last_synced_at` es un buzón recién conectado: 7 días, para que el
 * comercio vea un historial de verdad y no una bandeja vacía el primer día.
 */
export function ventanaDeBusqueda(
  lastSyncedAt: string | null | undefined,
): string {
  if (!lastSyncedAt) return "newer_than:7d";
  const desde = Date.parse(lastSyncedAt);
  if (!Number.isFinite(desde)) return "newer_than:1d";
  const hueco = Date.now() - desde;
  const dias = Math.max(1, Math.ceil(hueco / 86_400_000));
  // El día de gracia sólo cuando de verdad hubo un hueco: en el ritmo normal
  // —cada pocos minutos— pedir dos días sería traer el doble por nada.
  const gracia = hueco > 86_400_000 ? 1 : 0;
  return `newer_than:${Math.min(dias + gracia, 30)}d`;
}
