import type { SupabaseClient } from '@supabase/supabase-js';
import { createEmailWhatsAppLink, REVITALY_EMAIL_WORKSPACE, whatsappPhone } from '../channels/email/whatsapp-referral';

export const REVITALY_REDIRECT_RULE = 'centralizar_atencion_whatsapp';
// Mercado Libre is deliberately absent: never take its customers off-platform.
const CHANNELS = new Set(['instagram', 'messenger', 'webchat', 'fb_comment', 'ig_comment', 'tiktok_comment']);
export type RevitalyWhatsAppPolicy = { phone: string; displayPhone: string };

export async function loadRevitalyWhatsAppPolicy(db: SupabaseClient, workspaceId: string, channel: string): Promise<RevitalyWhatsAppPolicy | null> {
  if (workspaceId !== REVITALY_EMAIL_WORKSPACE || !CHANNELS.has(channel)) return null;
  const rule = await db.from('agent_guidance').select('id').eq('workspace_id', workspaceId)
    .is('agent_id', null).eq('clave', REVITALY_REDIRECT_RULE).eq('activa', true).maybeSingle();
  if (rule.error) throw new Error('whatsapp_redirect_policy_unavailable');
  if (!rule.data) return null;
  const connections = await db.from('channel_connections').select('id,config').eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp').eq('status', 'connected');
  if (connections.error) throw new Error('whatsapp_redirect_destination_unavailable');
  const destinations = (connections.data ?? []).filter(c => whatsappPhone(c.config));
  if (destinations.length !== 1) throw new Error('whatsapp_redirect_destination_ambiguous_or_unavailable');
  return { phone: whatsappPhone(destinations[0].config)!, displayPhone: String(destinations[0].config.display_phone_number) };
}

export function revitalyWhatsAppRedirectText(policy: RevitalyWhatsAppPolicy, language: string, url = `https://wa.me/${policy.phone}`): string {
  return language.toLowerCase().startsWith('en')
    ? `Thanks for contacting Revitaly. Please continue your inquiry on WhatsApp: ${policy.displayPhone}\n${url}`
    : `Gracias por contactar a Revitaly. Para atender tu consulta, escríbenos por WhatsApp: ${policy.displayPhone}\n${url}`;
}

export async function trackedRevitalyWhatsAppReply(db: SupabaseClient, args: {
  policy: RevitalyWhatsAppPolicy; workspaceId: string; channel: string; connectionId: string;
  conversationId?: string; sourceKey: string; language: string; isTest?: boolean;
}): Promise<string> {
  const url = await createEmailWhatsAppLink(db, {
    workspaceId: args.workspaceId, emailConnectionId: args.connectionId, sourceChannel: args.channel,
    kind: 'channel_inquiry', sourceKey: args.sourceKey, conversationId: args.conversationId,
    destinationPhone: args.policy.phone, language: args.language, isTest: args.isTest,
  });
  return revitalyWhatsAppRedirectText(args.policy, args.language, url);
}
