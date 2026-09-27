import type { SupabaseClient } from '@supabase/supabase-js';
import {customerEmailDisposition} from './revitaly-email-filter';

export interface EmailPolicy {
  mode: 'redirect' | 'assist' | 'manual';
  whatsapp_number: string;
  filter_notifications: boolean;
  prevent_repeated_redirects: boolean;
}
export const DEFAULT_EMAIL_POLICY: EmailPolicy = {
  mode: 'redirect', whatsapp_number: '', filter_notifications: true, prevent_repeated_redirects: true,
};
export const isEmailChannel = (channel: string) => ['gmail', 'outlook', 'zoho'].includes(channel);
export function emailDispositionForPolicy(policy: EmailPolicy, input: Parameters<typeof customerEmailDisposition>[0]) {
  let result=customerEmailDisposition({...input,preventRepeatedRedirects:policy.mode==='redirect'&&policy.prevent_repeated_redirects});
  if (!policy.filter_notifications && result==='ignore') result='customer';
  if (result!=='ignore' && (policy.mode==='manual' || (result==='customer'&&policy.mode==='redirect'&&!policy.whatsapp_number))) return 'review';
  if (policy.mode==='assist'&&result==='customer') return null;
  return result;
}
export function normalizeEmailPhone(value: string): string {
  return value.replace(/[+\s().-]/g, '');
}
export function validEmailPolicy(value: unknown): value is EmailPolicy {
  if (!value || typeof value !== 'object') return false;
  const p = value as EmailPolicy;
  return ['redirect', 'assist', 'manual'].includes(p.mode) && typeof p.whatsapp_number === 'string' &&
    (p.whatsapp_number === '' || /^[1-9]\d{7,14}$/.test(p.whatsapp_number)) &&
    typeof p.filter_notifications === 'boolean' && typeof p.prevent_repeated_redirects === 'boolean';
}
export async function loadEmailPolicy(db: SupabaseClient, workspaceId: string): Promise<EmailPolicy> {
  const {data, error} = await db.from('workspace_email_policy')
    .select('mode,whatsapp_number,filter_notifications,prevent_repeated_redirects').eq('workspace_id',workspaceId).maybeSingle();
  if (error) throw new Error('email_policy_unavailable');
  const policy = {...DEFAULT_EMAIL_POLICY, ...data};
  if (!policy.whatsapp_number && policy.mode === 'redirect') {
    const connected = await db.from('channel_connections').select('config')
      .eq('workspace_id',workspaceId).eq('channel','whatsapp').eq('status','connected');
    if (connected.error) throw new Error('email_destination_unavailable');
    const numbers = [...new Set((connected.data ?? []).map(c => normalizeEmailPhone(String(c.config?.display_phone_number ?? '')))
      .filter(n => /^[1-9]\d{7,14}$/.test(n)))];
    // Never select an arbitrary line when a merchant connected multiple numbers.
    if (numbers.length === 1) policy.whatsapp_number = numbers[0];
  }
  return policy;
}
export function emailRedirectText(policy: EmailPolicy, language: string): string | null {
  if (policy.mode !== 'redirect' || !/^[1-9]\d{7,14}$/.test(policy.whatsapp_number)) return null;
  const link = `https://wa.me/${policy.whatsapp_number}`;
  return language.startsWith('en')
    ? `Thanks for contacting us. We handle customer inquiries on WhatsApp. Please continue here: ${link}`
    : `Gracias por contactarnos. Atendemos las consultas por WhatsApp. Por favor, continúa aquí: ${link}`;
}
