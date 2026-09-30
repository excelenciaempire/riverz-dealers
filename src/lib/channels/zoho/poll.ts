import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, MessageAttachment } from '@/types';
import type { InboundEvent } from '../types';
import { supabaseAdmin } from '../admin-client';
import { listConnections } from '../connections';
import { savePollState } from '../poll-state';
import { recoveredEvent } from '../recovered-event';
import { ingestInboundEvent } from '../inbox-writer';
import { htmlToText } from '../html-to-text';
import { findMessageByExternalId } from '../message-lookup';
import { detectAutomatedSender } from '../email/automated-sender';
import {
  destinatarioCliente,
  direccionesDeCorreo,
  direccionesPropias,
} from '../email/direcciones';
import { FallaTransitoria, pedirAlProveedor } from '../email/falla-transitoria';
import {
  cursorGuardado,
  desdeSinCursor,
  estadoDeHistorial,
  planDeHistorial,
} from '../email/historial';
import { getFreshZohoAccessToken, mailApiUrl } from './auth';
import { mapWithConcurrency } from '@/lib/async/concurrency';
import {
  ingestRawMedia,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../media-ingest';

const CONNECTION_CONCURRENCY = 3;
/** Página del recorrido en vivo (el tope de Zoho para `messages/view`). */
const LIMITE = 200;
/** Página del historial: cada correo nuevo pide cuerpo y adjuntos, así que
 *  va más corta para que la corrida no se pase del tiempo del cron. */
const LIMITE_HISTORIAL = 50;

interface PollSummary {
  connectionId: string;
  email: string;
  ingested: number;
  error?: string;
}

interface ZohoMessage {
  messageId?: string | number;
  threadId?: string | number;
  folderId?: string | number;
  fromAddress?: string;
  toAddress?: string;
  ccAddress?: string;
  sender?: string;
  subject?: string;
  summary?: string;
  receivedTime?: string | number;
  receivedtime?: string | number;
  sentDateInGMT?: string | number;
  hasAttachment?: boolean | string | number;
  hasAttachments?: boolean | string | number;
}

interface ZohoAttachmentInfo {
  attachmentId?: string | number;
  attachment_id?: string | number;
  id?: string | number;
  attachmentName?: string;
  fileName?: string;
  name?: string;
  contentType?: string;
  mimeType?: string;
  size?: string | number;
  attachmentSize?: string | number;
  isInline?: boolean | string | number;
}

/**
 * Una carpeta que se recorre: la bandeja (lo que escribió el cliente) y
 * Enviados (lo que contestó el comercio). Antes sólo se leía la bandeja y en
 * cada hilo de Zoho faltaba la mitad del comercio: el agente no tenía de qué
 * aprender cómo responde la tienda.
 */
interface Carpeta {
  clave: 'inbox' | 'sent';
  folderId: string;
  saliente: boolean;
  /** Recorrido en vivo: cursor de fecha, posición de página y máximo visto. */
  cursor: string;
  inicio: string;
  maximo: string;
}

const clavesDeHistorial = (clave: Carpeta['clave']) => ({
  inicio: `zoho_backfill_${clave}_start`,
  hecho: `zoho_backfill_${clave}_done`,
});

/** Zoho Mail has no equivalent push subscription in this integration. We poll
 * the Inbox and Sent folders, and the database's unique message id constraint
 * makes overlap safe. */
export async function pollAllZohoConnections(): Promise<PollSummary[]> {
  const admin = supabaseAdmin();
  const connections = await listConnections(admin, { channel: 'zoho' });
  return mapWithConcurrency(
    connections,
    CONNECTION_CONCURRENCY,
    async (connection) => {
      const email = String(
        (connection.config ?? {}).email ?? connection.external_account_id ?? ''
      );
      try {
        return {
          connectionId: connection.id,
          email,
          ingested: await pollOne(admin, connection),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const result = {
          connectionId: connection.id,
          email,
          ingested: 0,
          error: message,
        };
        await admin
          .from('channel_connections')
          .update({ last_error: message.slice(0, 500) })
          .eq('id', connection.id);
        return result;
      }
    }
  );
}

/**
 * ¿Esta página cierra el recorrido? Zoho ordena del más nuevo al más viejo:
 * una página corta, o una que ya llegó al borde de abajo, es la última.
 */
export function recorridoZohoTerminado(
  tiempos: number[],
  limite: number,
  desdeMs: number
): boolean {
  return tiempos.length < limite || tiempos.some((t) => t > 0 && t <= desdeMs);
}

export async function pollOne(
  admin: SupabaseClient,
  connection: ChannelConnection
): Promise<number> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const accountId = String(config.zoho_account_id ?? '');
  const inboxId = String(config.zoho_inbox_folder_id ?? '');
  if (!accountId || !inboxId)
    throw new Error('[zoho] connection is missing inbox identity');
  const accessToken = await getFreshZohoAccessToken(admin, connection);
  const ahora = Date.now();
  const historial = planDeHistorial(config, ahora);
  const propias = direccionesPropias(connection);
  const sentId = await carpetaDeEnviados(connection, accessToken, accountId);

  const carpetas: Carpeta[] = [
    {
      clave: 'inbox',
      folderId: inboxId,
      saliente: false,
      cursor: 'last_received_at',
      inicio: 'zoho_sync_start',
      maximo: 'zoho_sync_newest',
    },
  ];
  if (sentId) {
    carpetas.push({
      clave: 'sent',
      folderId: sentId,
      saliente: true,
      cursor: 'last_sent_at',
      inicio: 'zoho_sent_start',
      maximo: 'zoho_sent_newest',
    });
  }

  const patch: Record<string, unknown> = sentId ? { zoho_sent_folder_id: sentId } : {};
  let ingested = 0;
  let vivoCompleto = true;
  // Sin la carpeta de enviados el historial no se da por terminado: se vuelve
  // a buscar en la próxima corrida.
  let historialCompleto = historial.pendiente && Boolean(sentId);

  for (const carpeta of carpetas) {
    // ── En vivo ──
    // El umbral queda fijo mientras dura el recorrido (el cursor sólo se
    // mueve al terminarlo), así una página corrida por correo nuevo repite
    // mensajes pero nunca saltea ninguno.
    const umbral = cursorGuardado(config[carpeta.cursor]) ?? desdeSinCursor(historial, ahora);
    const inicio = Number(config[carpeta.inicio] ?? 1) || 1;
    const pagina = await listarCarpeta(connection, accessToken, accountId, carpeta, inicio, LIMITE);
    let masNuevo = Number(config[carpeta.maximo] ?? umbral) || umbral;
    for (const message of pagina) {
      const receivedAt = messageTime(message);
      if (!message.messageId || !receivedAt || receivedAt <= umbral) continue;
      masNuevo = Math.max(masNuevo, receivedAt);
      if (await ingestZohoMessage(admin, connection, accessToken, message, receivedAt, carpeta, propias))
        ingested++;
    }
    const terminado = recorridoZohoTerminado(pagina.map(messageTime), LIMITE, umbral);
    Object.assign(
      patch,
      terminado
        ? {
            [carpeta.cursor]: new Date(masNuevo).toISOString(),
            [carpeta.inicio]: 1,
            [carpeta.maximo]: null,
          }
        : { [carpeta.inicio]: inicio + LIMITE, [carpeta.maximo]: masNuevo }
    );
    if (!terminado) vivoCompleto = false;

    // ── Historial ──
    if (!historial.pendiente) continue;
    const claves = clavesDeHistorial(carpeta.clave);
    if (config[claves.hecho] === true) continue;
    const inicioHistorial = Number(config[claves.inicio] ?? 1) || 1;
    const paginaHistorial = await listarCarpeta(
      connection,
      accessToken,
      accountId,
      carpeta,
      inicioHistorial,
      LIMITE_HISTORIAL
    );
    for (const message of paginaHistorial) {
      const receivedAt = messageTime(message);
      if (!message.messageId || !receivedAt) continue;
      if (receivedAt < historial.desdeMs || receivedAt >= historial.hastaMs) continue;
      if (await ingestZohoMessage(admin, connection, accessToken, message, receivedAt, carpeta, propias))
        ingested++;
    }
    const historialHecho = recorridoZohoTerminado(
      paginaHistorial.map(messageTime),
      LIMITE_HISTORIAL,
      historial.desdeMs
    );
    patch[claves.hecho] = historialHecho;
    patch[claves.inicio] = historialHecho ? null : inicioHistorial + LIMITE_HISTORIAL;
    if (!historialHecho) historialCompleto = false;
  }

  await savePollState(
    admin,
    connection.id,
    {
      ...patch,
      ...estadoDeHistorial(historial, historialCompleto, [
        ...Object.values(clavesDeHistorial('inbox')),
        ...Object.values(clavesDeHistorial('sent')),
      ]),
      poll_sync_complete: vivoCompleto && (!historial.pendiente || historialCompleto),
    },
    null,
    { complete: vivoCompleto }
  );
  return ingested;
}

/** La carpeta de enviados: guardada en config o descubierta una vez. */
async function carpetaDeEnviados(
  connection: ChannelConnection,
  accessToken: string,
  accountId: string
): Promise<string | null> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  if (config.zoho_sent_folder_id) return String(config.zoho_sent_folder_id);
  const response = await pedirAlProveedor(
    `${mailApiUrl(connection)}/api/accounts/${encodeURIComponent(accountId)}/folders`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    },
    '[zoho] list folders'
  );
  if (!response.ok) {
    // No frena la bandeja: se reintenta en la próxima corrida.
    console.warn(`[zoho] list folders failed (${response.status})`);
    return null;
  }
  const json = (await response.json()) as {
    data?: Array<{ folderId?: string | number; folderType?: string }>;
  };
  const sent = json.data?.find((f) => f.folderType?.toLowerCase() === 'sent')?.folderId;
  return sent == null ? null : String(sent);
}

async function listarCarpeta(
  connection: ChannelConnection,
  accessToken: string,
  accountId: string,
  carpeta: Carpeta,
  inicio: number,
  limite: number
): Promise<ZohoMessage[]> {
  const url = new URL(
    `${mailApiUrl(connection)}/api/accounts/${encodeURIComponent(accountId)}/messages/view`
  );
  url.searchParams.set('folderId', carpeta.folderId);
  url.searchParams.set('start', String(inicio));
  url.searchParams.set('limit', String(limite));
  url.searchParams.set('sortBy', 'date');
  url.searchParams.set('sortorder', 'false');
  // Sin `includeto` la lista no trae el destinatario, que en Enviados es el
  // cliente. `includearchive` suma lo archivado: conversaciones ya cerradas.
  url.searchParams.set('includeto', 'true');
  url.searchParams.set('includearchive', 'true');
  const response = await pedirAlProveedor(
    url,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    },
    `[zoho] list mail (${carpeta.clave})`
  );
  if (!response.ok)
    throw new Error(
      `[zoho] list mail failed (${response.status}): ${await response.text()}`
    );
  const listed = (await response.json()) as { data?: ZohoMessage[] };
  return listed.data ?? [];
}

/**
 * Guarda un correo de Zoho. Lo ya guardado se saltea ANTES de pedir el cuerpo
 * y los adjuntos: cada recorrido vuelve a pasar por mensajes que ya entraron.
 */
async function ingestZohoMessage(
  admin: SupabaseClient,
  connection: ChannelConnection,
  accessToken: string,
  message: ZohoMessage,
  receivedAt: number,
  carpeta: Carpeta,
  propias: Set<string>
): Promise<boolean> {
  const existente = await findMessageByExternalId(admin, {
    workspaceId: connection.workspace_id,
    channel: 'zoho',
    externalMessageId: String(message.messageId),
  });
  if (existente) return false;
  const event = await buildEvent(connection, accessToken, message, receivedAt, carpeta, propias);
  if (!event) return false;
  return Boolean(
    await ingestInboundEvent(admin, event.outbound ? event : recoveredEvent(event))
  );
}

async function buildEvent(
  connection: ChannelConnection,
  accessToken: string,
  message: ZohoMessage,
  receivedAt: number,
  carpeta: Carpeta,
  propias: Set<string>
): Promise<InboundEvent | null> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const accountId = String(config.zoho_account_id ?? '');
  const folderId = String(message.folderId ?? carpeta.folderId);
  if (!accountId || !folderId || !message.messageId) return null;
  const messageUrl = `${mailApiUrl(connection)}/api/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(String(message.messageId))}`;
  // Entrante: el cliente es el remitente. Enviado: el primer destinatario que
  // no sea el propio buzón (el hilo se arma igual que el entrante).
  const cliente = carpeta.saliente
    ? destinatarioCliente(
        message.toAddress
          ? [message.toAddress, message.ccAddress]
          : await destinatariosDeDetalle(messageUrl, accessToken),
        propias
      )
    : { email: direccionesDeCorreo(message.fromAddress)[0]?.email ?? '', name: message.sender ?? '' };
  if (!cliente?.email) return null;
  const contentUrl = `${messageUrl}/content`;
  // 429/5xx lanzan: antes el cuerpo quedaba vacío y el correo se guardaba así.
  const contentResponse = await pedirAlProveedor(
    contentUrl,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    },
    '[zoho] message content'
  );
  const contentJson = contentResponse.ok
    ? ((await contentResponse.json()) as {
        data?: { content?: string } | string;
      })
    : null;
  const raw =
    typeof contentJson?.data === 'string'
      ? contentJson.data
      : (contentJson?.data?.content ?? '');
  const html = /<[^>]+>/.test(raw) ? raw : '';
  const automated = carpeta.saliente
    ? { automated: false }
    : detectAutomatedSender({ from: cliente.email, subject: message.subject });
  const attachments = messageMayHaveAttachments(message)
    ? await fetchZohoAttachments({
        connection,
        accessToken,
        accountId,
        folderId,
        messageId: String(message.messageId),
        workspaceId: connection.workspace_id,
        conversationId: cliente.email,
      })
    : [];
  return {
    channel: 'zoho',
    connection,
    externalContactId: cliente.email,
    contactName: cliente.name || undefined,
    externalMessageId: String(message.messageId),
    externalThreadId:
      message.threadId == null
        ? String(message.messageId)
        : String(message.threadId),
    subject: message.subject ?? '',
    text: html ? htmlToText(raw) : raw || message.summary || '',
    htmlBody: html || undefined,
    suppressAutoReply: automated.automated || undefined,
    attachments: attachments.length ? attachments : undefined,
    receivedAt: new Date(receivedAt).toISOString(),
    ...(carpeta.saliente ? { outbound: true } : {}),
    raw: { zohoMessageId: String(message.messageId), ...(carpeta.saliente ? { sent: true } : {}) },
  };
}

/**
 * Zoho entrega primero la lista de adjuntos y luego los bytes por cada id.
 * Los re-alojamos igual que Gmail y Outlook para que el archivo siga visible
 * después de que caduque el enlace de Zoho.
 *
 * Un adjunto roto se saltea; un 429/5xx o una caída de red LANZA. Si no, el
 * correo quedaba guardado sin su archivo y, como ya existe, no se repetía.
 */
export async function fetchZohoAttachments(input: {
  connection: ChannelConnection;
  accessToken: string;
  accountId: string;
  folderId: string;
  messageId: string;
  workspaceId: string;
  conversationId: string;
}): Promise<MessageAttachment[]> {
  const base = `${mailApiUrl(input.connection)}/api/accounts/${encodeURIComponent(input.accountId)}/folders/${encodeURIComponent(input.folderId)}/messages/${encodeURIComponent(input.messageId)}`;
  try {
    const listed = await pedirAlProveedor(
      `${base}/attachmentinfo`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${input.accessToken}`,
          Accept: 'application/json',
        },
      },
      '[zoho] attachment info'
    );
    if (!listed.ok) return [];
    const body = (await listed.json()) as { data?: unknown };
    const refs = extractAttachmentInfo(body.data);
    const attachments: MessageAttachment[] = [];
    for (const ref of refs) {
      if (attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
      const attachmentId = String(
        ref.attachmentId ?? ref.attachment_id ?? ref.id ?? ''
      );
      if (!attachmentId || isInlineAttachment(ref)) continue;
      const declaredSize = Number(ref.attachmentSize ?? ref.size ?? 0);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_ATTACHMENT_BYTES)
        continue;
      try {
        const downloaded = await pedirAlProveedor(
          `${base}/attachments/${encodeURIComponent(attachmentId)}`,
          { headers: { Authorization: `Zoho-oauthtoken ${input.accessToken}` } },
          '[zoho] attachment'
        );
        if (!downloaded.ok) continue;
        const contentLength = Number(
          downloaded.headers.get('content-length') ?? 0
        );
        if (
          Number.isFinite(contentLength) &&
          contentLength > MAX_ATTACHMENT_BYTES
        )
          continue;
        const buffer = Buffer.from(await downloaded.arrayBuffer());
        if (buffer.length > MAX_ATTACHMENT_BYTES) continue;
        const name = String(
          ref.attachmentName ?? ref.fileName ?? ref.name ?? ''
        ).trim();
        const ingested = await ingestRawMedia({
          buffer,
          mime: String(
            ref.contentType ??
              ref.mimeType ??
              downloaded.headers.get('content-type') ??
              'application/octet-stream'
          ),
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          id: `${input.messageId}-${attachmentId}`.slice(0, 120),
          fileName: name || undefined,
        });
        if (!ingested) continue;
        attachments.push({
          url: ingested.url,
          mime_type: ingested.mediaMime,
          name: (ingested.fileName ?? name) || undefined,
          size: ingested.mediaSize,
        });
      } catch (error) {
        if (error instanceof FallaTransitoria) throw error;
        // Un adjunto roto nunca debe impedir que entre el resto del correo.
      }
    }
    return attachments;
  } catch (error) {
    if (error instanceof FallaTransitoria) throw error;
    return [];
  }
}

function extractAttachmentInfo(data: unknown): ZohoAttachmentInfo[] {
  if (Array.isArray(data)) return data as ZohoAttachmentInfo[];
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  for (const key of ['attachments', 'attachmentInfo', 'data']) {
    if (Array.isArray(record[key])) return record[key] as ZohoAttachmentInfo[];
  }
  return [];
}

function isInlineAttachment(ref: ZohoAttachmentInfo): boolean {
  const value = ref.isInline;
  return value === true || value === 'true' || value === '1' || value === 1;
}

function messageMayHaveAttachments(message: ZohoMessage): boolean {
  const value = message.hasAttachment ?? message.hasAttachments;
  // Older Zoho responses omit this field. Check attachmentinfo in that case
  // rather than silently losing a customer's file.
  return (
    value == null ||
    value === true ||
    value === 'true' ||
    value === '1' ||
    value === 1
  );
}

function messageTime(message: ZohoMessage): number {
  const value = Number(
    message.receivedTime ?? message.receivedtime ?? message.sentDateInGMT ?? 0
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** To/Cc desde el detalle del correo, cuando la lista no los trajo. */
async function destinatariosDeDetalle(
  messageUrl: string,
  accessToken: string
): Promise<Array<string | undefined>> {
  const response = await pedirAlProveedor(
    `${messageUrl}/details`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    },
    '[zoho] message details'
  );
  if (!response.ok) return [];
  const json = (await response.json()) as {
    data?: { toAddress?: string; ccAddress?: string };
  };
  return [json.data?.toAddress, json.data?.ccAddress];
}
