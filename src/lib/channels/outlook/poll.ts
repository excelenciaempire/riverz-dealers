import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { ingestInboundEvent } from "../inbox-writer";
import { fetchOutlookAttachments } from "./watch";
import { decrypt, encrypt } from "../encryption";
import { supabaseAdmin } from "../admin-client";
import { listConnections } from "../connections";
import { savePollState } from "../poll-state";
import { recoveredEvent } from '../recovered-event';
import { htmlToText } from "../html-to-text";
import { findMessageByExternalId } from "../message-lookup";
import { detectAutomatedSender } from "../email/automated-sender";
import { direccionesPropias } from "../email/direcciones";
import { pedirAlProveedor } from "../email/falla-transitoria";
import {
  cursorGuardado,
  desdeSinCursor,
  estadoDeHistorial,
  planDeHistorial,
} from "../email/historial";
import { mapWithConcurrency } from "@/lib/async/concurrency";

/**
 * Microsoft Graph polls every connected Outlook/Hotmail mailbox via
 * `/me/mailFolders/{folder}/messages` and ingests anything not yet seen.
 * Dedup falls out of the unique index on `messages.message_id`.
 *
 * Mirrors the Gmail poller intentionally so the cron infra stays
 * symmetrical — both run every 5 minutes and write `last_synced_at`.
 *
 * Dos recorridos por corrida:
 *   - en vivo: Inbox (`last_received_at`) y Enviados (`last_sent_at`), cada
 *     uno desde su cursor;
 *   - historial: los 90 días previos a la conexión, una sola vez por buzón
 *     (ver `email/historial.ts`): Inbox, Enviados y Archivo, que es donde
 *     terminan las conversaciones que el comercio ya cerró.
 */

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const OAUTH_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const CONNECTION_CONCURRENCY = 3;
/** Mensajes por carpeta y corrida del recorrido en vivo. */
const TOPE_EN_VIVO = 250;
/** Mensajes por carpeta y corrida del historial: se suma al vivo. */
const TOPE_HISTORIAL = 100;

type CampoFecha = "receivedDateTime" | "sentDateTime";
/** Quién escribió lo que hay en la carpeta. `remitente`: se mira el From. */
type Sentido = "entrante" | "saliente" | "remitente";

interface CarpetaDeHistorial {
  clave: "inbox" | "sent" | "archive";
  ruta: string;
  campo: CampoFecha;
  sentido: Sentido;
  /** Puede no existir en el buzón: un 404 es "nada que importar". */
  opcional?: boolean;
}

const CARPETAS_DE_HISTORIAL: CarpetaDeHistorial[] = [
  { clave: "inbox", ruta: "inbox", campo: "receivedDateTime", sentido: "entrante" },
  { clave: "sent", ruta: "sentitems", campo: "sentDateTime", sentido: "saliente" },
  { clave: "archive", ruta: "archive", campo: "receivedDateTime", sentido: "remitente", opcional: true },
];

const clavesDeHistorial = (c: CarpetaDeHistorial) => ({
  siguiente: `outlook_backfill_${c.clave}_next`,
  hecho: `outlook_backfill_${c.clave}_done`,
});

interface PollSummary {
  connectionId: string;
  email: string;
  ingested: number;
  error?: string;
}

export async function pollAllOutlookConnections(): Promise<PollSummary[]> {
  const admin = supabaseAdmin();
  // error/expired incluidos, igual que Gmail: el buzón que falló una vez tiene
  // que poder recuperarse solo.
  const connections = await listConnections(admin, { channel: "outlook" });
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

/**
 * El `$filter` de un tramo. Sin `hasta` es el recorrido en vivo (estrictamente
 * posterior al cursor); con `hasta`, el tramo cerrado del historial.
 */
export function filtroOutlook(
  campo: CampoFecha,
  desdeIso: string,
  hastaIso?: string,
): string {
  return hastaIso
    ? `${campo} ge ${desdeIso} and ${campo} lt ${hastaIso}`
    : `${campo} gt ${desdeIso}`;
}

async function pollOne(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<number> {
  const accessToken = await getFreshAccessToken(admin, connection);
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const ahora = Date.now();
  const historial = planDeHistorial(cfg, ahora);
  const propias = direccionesPropias(connection);

  // ── En vivo ──────────────────────────────────────────────────────────
  // Sin cursor: un día antes del corte del historial (lo anterior lo trae el
  // historial). The unique index on messages.message_id makes overlap free.
  const sinceMs =
    cursorGuardado(cfg.last_received_at) ?? desdeSinCursor(historial, ahora);
  const inboxPage = cfg.outlook_inbox_done ? { messages: [], next: null } : await listFolder(
    accessToken,
    "inbox",
    filtroOutlook("receivedDateTime", new Date(sinceMs).toISOString()),
    "receivedDateTime",
    { nextPage: cfg.outlook_inbox_next as string | undefined },
  );
  // Enviados: cursor PROPIO (last_sent_at). Antes se filtraban con el mismo
  // `since` anclado al último ENTRANTE, así que si el comercio respondía desde
  // el celular pero el cliente no contestaba, el cursor no avanzaba y la
  // ventana de enviados crecía sin control contra el tope de páginas.
  const sentSinceMs = cursorGuardado(cfg.last_sent_at) ?? sinceMs;
  const sentPage = cfg.outlook_sent_done ? { messages: [], next: null } : await listFolder(
    accessToken,
    "sentitems",
    filtroOutlook("sentDateTime", new Date(sentSinceMs).toISOString()),
    "sentDateTime",
    { nextPage: cfg.outlook_sent_next as string | undefined },
  );
  const complete = !inboxPage.next && !sentPage.next;
  const progress = {
    outlook_inbox_next: inboxPage.next, outlook_sent_next: sentPage.next,
    outlook_inbox_done: !complete && !inboxPage.next, outlook_sent_done: !complete && !sentPage.next,
  };

  let ingested = 0;
  let maxReceived = sinceMs;
  for (const msg of inboxPage.messages) {
    if (msg.receivedDateTime) {
      const t = new Date(msg.receivedDateTime).getTime();
      if (t > maxReceived) maxReceived = t;
    }
    if (await ingestOutlookMessage(admin, connection, accessToken, msg, "entrante", propias)) ingested++;
  }
  let maxSent = sentSinceMs;
  for (const msg of sentPage.messages) {
    if (msg.sentDateTime) {
      const t = new Date(msg.sentDateTime).getTime();
      if (t > maxSent) maxSent = t;
    }
    if (await ingestOutlookMessage(admin, connection, accessToken, msg, "saliente", propias)) ingested++;
  }

  // ── Historial ────────────────────────────────────────────────────────
  // Del más nuevo al más viejo, así lo reciente aparece primero. Cada carpeta
  // con su cursor: la que termina se saltea hasta que terminen todas.
  const avanceHistorial: Record<string, unknown> = {};
  let historialCompleto = historial.pendiente;
  if (historial.pendiente) {
    const desde = new Date(historial.desdeMs).toISOString();
    const hasta = new Date(historial.hastaMs).toISOString();
    for (const carpeta of CARPETAS_DE_HISTORIAL) {
      const claves = clavesDeHistorial(carpeta);
      if (cfg[claves.hecho] === true) continue;
      const pagina = await listFolder(
        accessToken,
        carpeta.ruta,
        filtroOutlook(carpeta.campo, desde, hasta),
        carpeta.campo,
        {
          nextPage: cfg[claves.siguiente] as string | undefined,
          tope: TOPE_HISTORIAL,
          orden: "desc",
          opcional: carpeta.opcional,
        },
      );
      for (const msg of pagina.messages) {
        if (await ingestOutlookMessage(admin, connection, accessToken, msg, carpeta.sentido, propias)) ingested++;
      }
      avanceHistorial[claves.siguiente] = pagina.next;
      avanceHistorial[claves.hecho] = !pagina.next;
      if (pagina.next) historialCompleto = false;
    }
  }

  await savePollState(
    admin,
    connection.id,
    {
      ...progress,
      last_received_at: new Date(maxReceived).toISOString(),
      last_sent_at: new Date(maxSent).toISOString(),
      ...avanceHistorial,
      ...estadoDeHistorial(
        historial,
        historialCompleto,
        CARPETAS_DE_HISTORIAL.flatMap((c) => Object.values(clavesDeHistorial(c))),
      ),
      poll_sync_complete: complete && (!historial.pendiente || historialCompleto),
    },
    null,
    { complete },
  );
  return ingested;
}

/**
 * Guarda un mensaje de Graph en la bandeja. Lo ya guardado se saltea ANTES de
 * bajar adjuntos: el poll vuelve a pasar por lo que entró por el aviso de
 * Graph, y antes cada pasada bajaba otra vez todos sus archivos.
 */
async function ingestOutlookMessage(
  admin: SupabaseClient,
  connection: ChannelConnection,
  accessToken: string,
  msg: GraphMessage,
  sentido: Sentido,
  propias: Set<string>,
): Promise<boolean> {
  const remitente = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
  const saliente =
    sentido === "saliente" || (sentido === "remitente" && propias.has(remitente));
  const existente = await findMessageByExternalId(admin, {
    workspaceId: connection.workspace_id,
    channel: "outlook",
    externalMessageId: msg.internetMessageId || msg.id,
  });
  if (existente) return false;

  if (saliente) {
    const event = await buildOutboundEvent(connection, msg, accessToken, propias);
    return Boolean(event && (await ingestInboundEvent(admin, event)));
  }
  const event = buildInboundEvent(connection, msg);
  if (!event) return false;
  // Re-host any file attachments the customer emailed so the inbox can
  // show them. Keyed by sender email (the conversation row doesn't
  // exist yet). Un 429/5xx lanza: la corrida no guarda el cursor.
  if (msg.hasAttachments) {
    const atts = await fetchOutlookAttachments(
      accessToken,
      msg.id,
      connection.workspace_id,
      event.externalContactId,
    );
    if (atts.length) event.attachments = atts;
  }
  return Boolean(await ingestInboundEvent(admin, recoveredEvent(event)));
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
    return decrypt(encAccess);
  }

  const refreshToken = decrypt(encRefresh);
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID/SECRET missing — cannot refresh");
  }
  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline_access Mail.ReadWrite Mail.Send User.Read",
    }).toString(),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`refresh failed (${r.status}): ${detail}`);
  }
  const json = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const fresh = json.access_token;
  if (!fresh) throw new Error("refresh response missing access_token");

  const newSecrets: Record<string, unknown> = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(json.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  // Microsoft sometimes rotates the refresh token; persist when present.
  if (json.refresh_token) {
    newSecrets.refresh_token = encrypt(json.refresh_token);
  }
  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}

async function listFolder(
  accessToken: string,
  folder: string,
  filter: string,
  dateField: CampoFecha,
  opciones: {
    nextPage?: string;
    tope?: number;
    orden?: "asc" | "desc";
    opcional?: boolean;
  } = {},
): Promise<{ messages: GraphMessage[]; next: string | null }> {
  const u = new URL(`${GRAPH_API}/me/mailFolders/${folder}/messages`);
  u.searchParams.set(
    "$select",
    "id,internetMessageId,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,body,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageHeaders",
  );
  u.searchParams.set("$top", "50");
  u.searchParams.set("$orderby", `${dateField} ${opciones.orden ?? "asc"}`);
  u.searchParams.set("$filter", filter);

  // Seguimos @odata.nextLink hasta un tope prudente: antes $top=50 sin paginar
  // descartaba el resto en buzones activos (se perdían entrantes y salientes).
  const tope = opciones.tope ?? TOPE_EN_VIVO;
  const out: GraphMessage[] = [];
  let url: string | null = u.toString();
  if (opciones.nextPage) {
    const next = new URL(opciones.nextPage);
    if (next.origin !== new URL(GRAPH_API).origin || !next.pathname.startsWith('/v1.0/me/')) throw new Error('invalid_outlook_cursor');
    url = next.toString();
  }
  while (url && out.length < tope) {
    // 429/5xx lanzan: el cursor guardado no avanza y la próxima corrida repite.
    const r = await pedirAlProveedor(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      `messages.list(${folder})`,
    );
    if (r.status === 404 && opciones.opcional) {
      // La carpeta no existe en este buzón (p. ej. nunca se archivó nada).
      return { messages: [], next: null };
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`messages.list(${folder}) ${r.status}: ${detail}`);
    }
    const j = (await r.json()) as {
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
    };
    for (const m of j.value ?? []) out.push(m);
    // nextLink ya trae el $filter/$orderby embebidos: se refetchea tal cual.
    url = j["@odata.nextLink"] ?? null;
  }
  return { messages: out, next: url };
}

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };

async function buildOutboundEvent(
  connection: ChannelConnection,
  msg: GraphMessage,
  accessToken: string,
  propias: Set<string>,
): Promise<InboundEvent | null> {
  // Sent mail is addressed TO the customer — that's the conversation
  // owner: the first To/Cc that isn't the mailbox itself.
  const cliente = [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])]
    .map((r) => r.emailAddress)
    .find((a) => {
      const address = a?.address?.toLowerCase();
      return Boolean(address && !propias.has(address));
    });
  const to = cliente?.address?.toLowerCase();
  if (!to) return null;
  const html = msg.body?.contentType === "html" ? (msg.body.content ?? "") : "";
  const text = msg.body?.contentType === "text" ? (msg.body.content ?? "") : "";
  const event: InboundEvent = {
    channel: "outlook",
    connection,
    externalContactId: to,
    contactName: cliente?.name || undefined,
    externalMessageId: msg.internetMessageId || msg.id,
    externalThreadId: msg.conversationId,
    subject: msg.subject ?? "",
    text: text || htmlToText(html) || msg.bodyPreview || "",
    htmlBody: html || undefined,
    receivedAt:
      msg.sentDateTime ?? msg.receivedDateTime ?? new Date().toISOString(),
    outbound: true,
    raw: { graphId: msg.id, sent: true },
  };
  // Los adjuntos de una respuesta enviada desde el celular/Outlook también se
  // re-hostean (mismo camino que el entrante), para que en Riverz se vea el
  // archivo y no solo el texto.
  if (msg.hasAttachments) {
    const atts = await fetchOutlookAttachments(
      accessToken,
      msg.id,
      connection.workspace_id,
      to,
    );
    if (atts.length) event.attachments = atts;
  }
  return event;
}

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  internetMessageHeaders?: { name: string; value: string }[];
}

function buildInboundEvent(
  connection: ChannelConnection,
  msg: GraphMessage,
): InboundEvent | null {
  const from = msg.from?.emailAddress;
  const email = from?.address?.toLowerCase();
  if (!email) return null;

  const html = msg.body?.contentType === "html" ? (msg.body.content ?? "") : "";
  const text = msg.body?.contentType === "text" ? (msg.body.content ?? "") : "";
  // Rebotes, autorespuestas y boletines entran a la bandeja pero NADIE los
  // contesta solo. Ver `email/automated-sender.ts`.
  const machine = detectAutomatedSender({
    from: email,
    subject: msg.subject,
    headers: msg.internetMessageHeaders,
  });
  if (machine.automated) {
    console.info(
      `[outlook-poll] remitente automático (${machine.reason}), no se responde solo: ${email}`,
    );
  }
  return {
    channel: "outlook",
    connection,
    externalContactId: email,
    contactName: from?.name || undefined,
    suppressAutoReply: machine.automated || undefined,
    externalMessageId: msg.internetMessageId || msg.id,
    externalThreadId: msg.conversationId,
    subject: msg.subject ?? "",
    text: text || htmlToText(html) || msg.bodyPreview || "",
    htmlBody: html || undefined,
    receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
    raw: { graphId: msg.id },
  };
}
