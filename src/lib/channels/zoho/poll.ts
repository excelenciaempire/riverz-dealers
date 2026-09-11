import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, MessageAttachment } from '@/types';
import type { InboundEvent } from '../types';
import { supabaseAdmin } from '../admin-client';
import { listConnections } from '../connections';
import { savePollState } from '../poll-state';
import { recoveredEvent } from '../recovered-event';
import { ingestInboundEvent } from '../inbox-writer';
import { htmlToText } from '../html-to-text';
import { detectAutomatedSender } from '../email/automated-sender';
import { getFreshZohoAccessToken, mailApiUrl } from './auth';
import { mapWithConcurrency } from '@/lib/async/concurrency';
import {
  ingestRawMedia,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../media-ingest';

const CONNECTION_CONCURRENCY = 3;

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
  sender?: string;
  subject?: string;
  summary?: string;
  receivedTime?: string | number;
  receivedtime?: string | number;
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

/** Zoho Mail has no equivalent push subscription in this integration. We poll
 * the Inbox, and the database's unique message id constraint makes overlap safe. */
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

async function pollOne(
  admin: SupabaseClient,
  connection: ChannelConnection
): Promise<number> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const accountId = String(config.zoho_account_id ?? '');
  const folderId = String(config.zoho_inbox_folder_id ?? '');
  if (!accountId || !folderId)
    throw new Error('[zoho] connection is missing inbox identity');
  const accessToken = await getFreshZohoAccessToken(admin, connection);
  const url = new URL(
    `${mailApiUrl(connection)}/api/accounts/${encodeURIComponent(accountId)}/messages/view`
  );
  url.searchParams.set('folderId', folderId);
  url.searchParams.set('start', String(config.zoho_sync_start ?? 1));
  url.searchParams.set('limit', '200');
  url.searchParams.set('sortBy', 'date');
  url.searchParams.set('sortorder', 'false');
  const response = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok)
    throw new Error(
      `[zoho] list mail failed (${response.status}): ${await response.text()}`
    );
  const listed = (await response.json()) as { data?: ZohoMessage[] };
  const lastReceived = config.last_received_at
    ? new Date(String(config.last_received_at)).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  let newest = Number(config.zoho_sync_newest ?? lastReceived);
  let ingested = 0;
  for (const message of listed.data ?? []) {
    const receivedAt = messageTime(message);
    if (!message.messageId || !receivedAt || receivedAt <= lastReceived)
      continue;
    newest = Math.max(newest, receivedAt);
    const event = await buildEvent(
      connection,
      accessToken,
      message,
      receivedAt
    );
    if (event && (await ingestInboundEvent(admin, recoveredEvent(event))))
      ingested++;
  }
  const complete =
    (listed.data?.length ?? 0) < 200 ||
    (listed.data ?? []).some((m) => {
      const at = messageTime(m);
      return at && at <= lastReceived;
    });
  await savePollState(
    admin,
    connection.id,
    {
      ...(complete ? { last_received_at: new Date(newest).toISOString() } : {}),
      zoho_sync_start: complete ? 1 : Number(config.zoho_sync_start ?? 1) + 200,
      zoho_sync_newest: complete ? null : newest,
      poll_sync_complete: complete,
    },
    null,
    { complete }
  );
  return ingested;
}

async function buildEvent(
  connection: ChannelConnection,
  accessToken: string,
  message: ZohoMessage,
  receivedAt: number
): Promise<InboundEvent | null> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const accountId = String(config.zoho_account_id ?? '');
  const folderId = String(
    message.folderId ?? config.zoho_inbox_folder_id ?? ''
  );
  const from = extractAddress(message.fromAddress ?? '');
  if (!accountId || !folderId || !from || !message.messageId) return null;
  const contentUrl = `${mailApiUrl(connection)}/api/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(String(message.messageId))}/content`;
  const contentResponse = await fetch(contentUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
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
  const automated = detectAutomatedSender({ from, subject: message.subject });
  const attachments = messageMayHaveAttachments(message)
    ? await fetchZohoAttachments({
        connection,
        accessToken,
        accountId,
        folderId,
        messageId: String(message.messageId),
        workspaceId: connection.workspace_id,
        conversationId: from,
      })
    : [];
  return {
    channel: 'zoho',
    connection,
    externalContactId: from,
    contactName: message.sender || undefined,
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
    raw: { zohoMessageId: String(message.messageId) },
  };
}

/**
 * Zoho entrega primero la lista de adjuntos y luego los bytes por cada id.
 * Los re-alojamos igual que Gmail y Outlook para que el archivo siga visible
 * después de que caduque el enlace de Zoho.
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
    const listed = await fetch(`${base}/attachmentinfo`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${input.accessToken}`,
        Accept: 'application/json',
      },
    });
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
        const downloaded = await fetch(
          `${base}/attachments/${encodeURIComponent(attachmentId)}`,
          { headers: { Authorization: `Zoho-oauthtoken ${input.accessToken}` } }
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
      } catch {
        // Un adjunto roto nunca debe impedir que entre el resto del correo.
      }
    }
    return attachments;
  } catch {
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
  const value = Number(message.receivedTime ?? message.receivedtime ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function extractAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim().toLowerCase();
}
