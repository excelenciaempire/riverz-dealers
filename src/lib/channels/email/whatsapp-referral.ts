import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Conversation } from '@/types';
import type { InboundEvent } from '../types';

export const REVITALY_EMAIL_WORKSPACE = '234604a9-909b-4e50-952b-acde4a85593a';
const EMAIL_CHANNELS = new Set(['gmail', 'outlook', 'zoho']);
const URLS = /https?:\/\/[^\s<>"']+/g;
const TOKEN = /\[RZ-([a-f0-9]{24})\]/i;
export type EmailReferral = {
  kind: 'purchase_guide' | 'email_inquiry';
  orderName: string | null;
  sourceConversationId: string | null;
  receivedAt: string;
};

export function whatsappPhone(config: unknown): string | null {
  const cfg = config as Record<string, unknown> | null;
  const phone = String(cfg?.display_phone_number ?? '').replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function whatsappLinkPhone(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === 'wa.me')
      return url.pathname.slice(1).replace(/\D/g, '') || null;
    if (
      ['api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname) &&
      url.pathname === '/send'
    )
      return url.searchParams.get('phone')?.replace(/\D/g, '') || null;
  } catch {
    /* A malformed URL is not a WhatsApp destination. */
  }
  return null;
}

function checked<T extends { error: unknown }>(result: T): T {
  if (result.error) throw result.error;
  return result;
}

export async function createEmailWhatsAppLink(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    emailConnectionId: string;
    sourceKey: string;
    kind: EmailReferral['kind'];
    conversationId?: string;
    orderId?: string;
    orderName?: string;
    language?: string;
    destinationPhone?: string;
    isTest?: boolean;
  }
): Promise<string> {
  const mail = checked(
    await db
      .from('channel_connections')
      .select('id,channel')
      .eq('id', args.emailConnectionId)
      .eq('workspace_id', args.workspaceId)
      .eq('status', 'connected')
      .maybeSingle()
  ).data;
  if (!mail || !EMAIL_CHANNELS.has(mail.channel))
    throw new Error('email_referral_mailbox_unavailable');
  const connections =
    checked(
      await db
        .from('channel_connections')
        .select('id,config')
        .eq('workspace_id', args.workspaceId)
        .eq('channel', 'whatsapp')
        .eq('status', 'connected')
    ).data ?? [];
  const destinations = connections.filter(
    (c) =>
      whatsappPhone(c.config) &&
      (!args.destinationPhone ||
        whatsappPhone(c.config) === args.destinationPhone)
  );
  if (destinations.length !== 1)
    throw new Error('email_referral_whatsapp_ambiguous_or_unavailable');
  const connection = destinations[0];
  const key = createHash('sha256')
    .update(`${args.emailConnectionId}:${args.sourceKey}:${connection.id}`)
    .digest('hex');
  if (args.conversationId) {
    const conversation = checked(
      await db
        .from('conversations')
        .select('id')
        .eq('id', args.conversationId)
        .eq('workspace_id', args.workspaceId)
        .eq('connection_id', args.emailConnectionId)
        .maybeSingle()
    ).data;
    if (!conversation)
      throw new Error('email_referral_conversation_scope_mismatch');
  }
  const token = randomBytes(12).toString('hex');
  const en = args.language?.toLowerCase().startsWith('en');
  const message =
    args.kind === 'purchase_guide'
      ? en
        ? 'Hi, I received my Revitaly guide by email and have a question.'
        : 'Hola, recibí la guía de Revitaly por correo y tengo una duda.'
      : en
        ? 'Hi, I am contacting you from the email to continue my inquiry.'
        : 'Hola, vengo del correo para continuar mi consulta.';
  checked(
    await db.from('email_whatsapp_links').upsert(
      {
        token,
        workspace_id: args.workspaceId,
        email_connection_id: args.emailConnectionId,
        whatsapp_connection_id: connection.id,
        source_key: key,
        source_kind: args.kind,
        source_conversation_id: args.conversationId ?? null,
        order_id: args.orderId ?? null,
        order_name: args.orderName ?? null,
        is_test: args.isTest ?? false,
        prefill: `${message} [RZ-${token}]`,
      },
      { onConflict: 'workspace_id,source_key', ignoreDuplicates: true }
    )
  );
  const row = checked(
    await db
      .from('email_whatsapp_links')
      .select('token')
      .eq('workspace_id', args.workspaceId)
      .eq('source_key', key)
      .single()
  ).data;
  if (!row) throw new Error('email_referral_link_not_persisted');
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL || 'https://riverzai.com'
  ).replace(/\/+$/, '');
  return `${base}/api/email/whatsapp/${row.token}`;
}

/** Called before persistence, and again by the guarded adapter as a safety net. */
export async function prepareEmailWhatsAppLinks(
  db: SupabaseClient,
  args: {
    text: string;
    channel: string;
    workspaceId: string;
    connectionId?: string;
    conversationId?: string;
  }
): Promise<string> {
  if (
    args.workspaceId !== REVITALY_EMAIL_WORKSPACE ||
    !EMAIL_CHANNELS.has(args.channel)
  )
    return args.text;
  const matches = [...args.text.matchAll(URLS)]
    .map((m) => ({
      raw: m[0],
      url: m[0].replace(/[.,;:!?)\]}]+$/, ''),
    }))
    .filter((m) => whatsappLinkPhone(m.url));
  if (!matches.length) return args.text;
  if (!args.connectionId) throw new Error('email_referral_missing_connection');
  let result = args.text;
  for (const match of matches) {
    const url = await createEmailWhatsAppLink(db, {
      workspaceId: args.workspaceId,
      emailConnectionId: args.connectionId,
      sourceKey: `${args.conversationId ?? 'outbound'}:${args.text}`,
      kind: 'email_inquiry',
      conversationId: args.conversationId,
      destinationPhone: whatsappLinkPhone(match.url)!,
      language: /\b(Hi|Hello|WhatsApp support)\b/i.test(args.text)
        ? 'en'
        : 'es',
    });
    result = result.replaceAll(match.url, url);
  }
  return result;
}

/** A link proves its source, never the identity or ownership of the order. */
export async function captureEmailWhatsAppInquiry(
  db: SupabaseClient,
  args: {
    event: InboundEvent;
    conversationId: string;
    messageId: string;
  }
): Promise<EmailReferral | null> {
  const { event } = args;
  if (event.channel !== 'whatsapp' || event.outbound || event.historical)
    return null;
  const token = TOKEN.exec(event.text)?.[1]?.toLowerCase();
  if (!token) return null;
  return checked(
    await db.rpc('record_email_whatsapp_inquiry', {
      p_token: token,
      p_workspace_id: event.connection.workspace_id,
      p_connection_id: event.connection.id,
      p_conversation_id: args.conversationId,
      p_message_id: args.messageId,
    })
  ).data as EmailReferral | null;
}

export function emailReferralContext(
  referral: Conversation['email_referral']
): string | null {
  if (!referral) return null;
  return (
    'Origen registrado: consulta desde un enlace de correo. ' +
    (referral.kind === 'purchase_guide'
      ? `Correo de la guía de compra; pedido de referencia: ${JSON.stringify(referral.orderName)}.`
      : 'Derivación de una consulta por correo.') +
    ' El enlace puede reenviarse: no acredita identidad ni propiedad del pedido. Verifica los datos antes de consultar información privada o modificar un pedido.'
  );
}
