import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  OutboundMedia,
  ParsedWebhookContext,
  SendResult,
} from '../types';
import type { ChannelConnection } from '@/types';
import { supabaseAdmin } from '../admin-client';
import { conFirma } from '../firma-de-correo';
import { getFreshZohoAccessToken, mailApiUrl } from './auth';
import { fetchAttachmentBytes } from '../media-ingest';
import { safeLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * Zoho Mail adapter. Zoho does not provide the webhook subscription used by
 * Microsoft and Google here; inbound syncing is intentionally handled by a
 * poller. Outbound replies and AI responses use this adapter immediately.
 */
export const zohoAdapter: ChannelAdapter = {
  channel: 'zoho',
  label: 'Zoho Mail',

  isConfigured(connection: ChannelConnection): boolean {
    const config = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(
      config.email && config.zoho_account_id && connection.secrets
    );
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const config = (input.connection.config ?? {}) as Record<string, unknown>;
    const accountId = String(config.zoho_account_id ?? '');
    const from = String(
      config.email ?? input.connection.external_account_id ?? ''
    );
    const to = input.contact.email || input.contact.external_id;
    if (!accountId || !from)
      throw new Error('[zoho] connection is missing mailbox identity');
    if (!to) throw new Error('[zoho] contact is missing email address');

    const admin = supabaseAdmin();
    const accessToken = await getFreshZohoAccessToken(admin, input.connection);
    const replyTo =
      input.replyToExternalId ??
      (await latestInboundMessageId(admin, input.conversation.id));
    const endpoint = replyTo
      ? `${mailApiUrl(input.connection)}/api/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(replyTo)}`
      : `${mailApiUrl(input.connection)}/api/accounts/${encodeURIComponent(accountId)}/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: from,
        toAddress: to,
        subject: withRePrefix(input.conversation.subject ?? '(no subject)'),
        content: conFirma(input.text, input.connection),
        mailFormat: 'plaintext',
        ...(replyTo ? { action: 'reply' } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(
        `[zoho] send failed (${response.status}): ${await response.text()}`
      );
    }
    const json = (await response.json()) as {
      data?: {
        messageId?: string | number;
        messageIdList?: Array<string | number>;
      };
    };
    const messageId = json.data?.messageId ?? json.data?.messageIdList?.[0];
    return {
      externalMessageId: messageId == null ? undefined : String(messageId),
      status: 'sent',
    };
  },

  async sendMedia(input: OutboundMedia): Promise<SendResult> {
    const locale = await safeLocale();
    const config = (input.connection.config ?? {}) as Record<string, unknown>;
    const accountId = String(config.zoho_account_id ?? '');
    const from = String(config.email ?? input.connection.external_account_id ?? '');
    const to = input.contact.email || input.contact.external_id;
    if (!accountId || !from || !to) throw new Error(translate(locale, 'voiceNotes.conversationMissing'));
    const file = await fetchAttachmentBytes(input.mediaUrl, input.connection.workspace_id);
    if (!file) throw new Error(translate(locale, 'errInbox.attachmentUnreadable'));
    const token = await getFreshZohoAccessToken(supabaseAdmin(), input.connection);
    const base = `${mailApiUrl(input.connection)}/api/accounts/${encodeURIComponent(accountId)}/messages`;
    const headers = { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' };
    const upload = await fetch(`${base}/attachments?fileName=${encodeURIComponent(input.filename || 'audio.mp3')}&isInline=false`, {
      method: 'POST', headers: { ...headers, 'content-type': file.mime }, body: new Uint8Array(file.buffer),
    });
    if (!upload.ok) throw new Error(translate(locale, 'voiceNotes.failed'));
    const uploaded = await upload.json();
    const attachment = Array.isArray(uploaded.data) ? uploaded.data[0] : uploaded.data;
    if (uploaded.status?.code >= 400 || !attachment?.storeName || !attachment.attachmentName || !attachment.attachmentPath)
      throw new Error(translate(locale, 'voiceNotes.failed'));
    // Use Zoho's documented attachment-send endpoint; the reply endpoint does
    // not document attachments and must not silently discard the audio.
    const response = await fetch(base, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ fromAddress: from, toAddress: to,
        subject: withRePrefix(input.conversation.subject ?? '(no subject)'),
        content: conFirma(input.caption ?? '', input.connection), mailFormat: 'plaintext',
        attachments: [{ storeName: attachment.storeName, attachmentName: attachment.attachmentName, attachmentPath: attachment.attachmentPath }],
      }),
    });
    if (!response.ok) throw new Error(translate(locale, 'voiceNotes.failed'));
    const sent = await response.json();
    if (sent.status?.code >= 400) throw new Error(translate(locale, 'voiceNotes.failed'));
    const id = sent.data?.messageId ?? sent.data?.messageIdList?.[0];
    return { externalMessageId: id == null ? undefined : String(id), status: 'sent' };
  },

  async parseWebhook(
    _ctx: ParsedWebhookContext,
    _connection: ChannelConnection
  ): Promise<InboundEvent[]> {
    return [];
  },
};

async function latestInboundMessageId(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string
): Promise<string | undefined> {
  const { data } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { message_id?: string } | null)?.message_id ?? undefined;
}

function withRePrefix(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`;
}
