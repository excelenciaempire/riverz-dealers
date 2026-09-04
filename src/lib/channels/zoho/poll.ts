import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import type { InboundEvent } from '../types';
import { supabaseAdmin } from '../admin-client';
import { listConnections } from '../connections';
import { ingestInboundEvent } from '../inbox-writer';
import { htmlToText } from '../html-to-text';
import { detectAutomatedSender } from '../email/automated-sender';
import { getFreshZohoAccessToken, mailApiUrl } from './auth';
import { mapWithConcurrency } from '@/lib/async/concurrency';

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
  url.searchParams.set('start', '1');
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
  let newest = lastReceived;
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
    if (event && (await ingestInboundEvent(admin, event))) ingested++;
  }
  await admin
    .from('channel_connections')
    .update({
      config: { ...config, last_received_at: new Date(newest).toISOString() },
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', connection.id);
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
    receivedAt: new Date(receivedAt).toISOString(),
    raw: { zohoMessageId: String(message.messageId) },
  };
}

function messageTime(message: ZohoMessage): number {
  const value = Number(message.receivedTime ?? message.receivedtime ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function extractAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim().toLowerCase();
}
