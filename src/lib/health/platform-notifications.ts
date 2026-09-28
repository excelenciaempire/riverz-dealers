import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { AlertHistory } from './alert-history';

export interface PendingNotification {
  id: string;
  channel: 'whatsapp' | 'email';
  keys: string[];
  title: string;
  lines: Record<string, string>;
  attempts: number;
  nextAttemptAt: string;
}
export interface WatchState {
  fingerprint: string;
  alert_history: AlertHistory;
  pending_notifications: PendingNotification[];
  notification_lease_id: string;
  updated_at?: string;
}

/** Persist the outbox before sending, and acknowledge each channel separately.
 * A successful email must never discard a failed WhatsApp notification. */
export async function deliverPlatformNotifications(args: {
  db: SupabaseClient;
  state: WatchState;
  fingerprint: string;
  history: AlertHistory;
  newKeys: string[];
  lines: Map<string, string>;
  whatsappTitle: string;
  emailTitle: string;
  recipients: { phone: string | null; email: string | null };
  sendWhatsApp: (to: string, title: string, body: string) => Promise<boolean>;
  sendEmail: (to: string, title: string, body: string) => Promise<boolean>;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const active = new Set(args.fingerprint.split('|'));
  let pending = (args.state.pending_notifications ?? []).map((item) => ({
    ...item, keys: item.keys.filter((key) => active.has(key)),
  })).filter((item) => item.keys.length > 0);
  if (args.newKeys.length) {
    for (const channel of ['whatsapp', 'email'] as const) {
      if (channel === 'email' && !args.recipients.email) continue;
      pending.push({
        id: randomUUID(), channel, keys: args.newKeys,
        title: channel === 'whatsapp' ? args.whatsappTitle : args.emailTitle,
        lines: Object.fromEntries(args.newKeys.map((key) => [key, args.lines.get(key)!])),
        attempts: 0, nextAttemptAt: new Date(now).toISOString(),
      });
    }
  }
  const save = async (notified = false) => {
    const { data, error } = await args.db.from('platform_watch_state').update({
      fingerprint: args.fingerprint, alert_history: args.history,
      pending_notifications: pending, updated_at: new Date(now).toISOString(),
      ...(notified ? { notified_at: new Date(now).toISOString() } : {}),
    }).eq('id', true).eq('notification_lease_id', args.state.notification_lease_id).select('id');
    if (error || !data?.length) throw new Error('platform_notification_snapshot_failed');
  };
  if (args.fingerprint !== args.state.fingerprint || pending.length || args.state.pending_notifications?.length) await save();
  const via: string[] = [];
  for (const item of pending.filter((value) => Date.parse(value.nextAttemptAt) <= now).slice(0, 8)) {
    const recipient = item.channel === 'whatsapp' ? args.recipients.phone : args.recipients.email;
    const lines = item.keys.map((key) => args.lines.get(key) ?? item.lines[key]);
    const body = [...lines.slice(0, 8), ...(lines.length > 8 ? [`+${lines.length - 8}`] : [])].join('\n');
    let accepted = false;
    try {
      if (recipient) accepted = item.channel === 'whatsapp'
        ? await args.sendWhatsApp(recipient, item.title, body)
        : await args.sendEmail(recipient, item.title, body);
    } catch { /* Keep this channel queued; a provider failure is not delivery. */ }
    if (accepted) {
      pending = pending.filter((value) => value.id !== item.id);
      via.push(item.channel === 'email' ? 'correo' : 'whatsapp');
    } else {
      item.attempts += 1;
      item.nextAttemptAt = new Date(now + Math.min(4 * 60, 15 * 2 ** Math.min(item.attempts - 1, 5)) * 60_000).toISOString();
    }
    await save(accepted);
  }
  return { via: [...new Set(via)], pending: pending.length, whatsappPending: pending.filter((item) => item.channel === 'whatsapp').length };
}
