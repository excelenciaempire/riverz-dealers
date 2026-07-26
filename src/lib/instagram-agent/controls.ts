import type { SupabaseClient } from '@supabase/supabase-js';

export type ProactiveGate = { ok: boolean; reason?: 'paused' | 'daily_cap' };

const DEFAULT_DAILY_CAP = 500;

/**
 * Trust gate for proactive Instagram DMs: a workspace emergency-pause
 * (kill-switch) + a rolling-24h daily cap (protects sender reputation + Meta
 * rate limits). Checked by the real-time outreach and the batch cron before
 * sending. No settings row → defaults (not paused, 500/day).
 */
export async function proactiveGate(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ProactiveGate> {
  const { data } = await db
    .from('ig_proactive_settings')
    .select('paused, daily_cap')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const s = data as { paused?: boolean; daily_cap?: number } | null;
  return gateFromSettings(db, workspaceId, s);
}

/** ¿Está encendido el piso autónomo (responder comentarios sin campaña)? */
export async function autoReplyCommentsEnabled(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await db
    .from('ig_proactive_settings')
    .select('auto_reply_comments')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  // Sin fila de ajustes → encendido (el default de la columna).
  return (data as { auto_reply_comments?: boolean } | null)?.auto_reply_comments !== false;
}

async function gateFromSettings(
  db: SupabaseClient,
  workspaceId: string,
  s: { paused?: boolean; daily_cap?: number } | null,
): Promise<ProactiveGate> {
  if (s?.paused) return { ok: false, reason: 'paused' };
  const cap = s?.daily_cap ?? DEFAULT_DAILY_CAP;
  if (cap <= 0) return { ok: true }; // 0 = unlimited
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('ig_proactive_log')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', since);
  if ((count ?? 0) >= cap) return { ok: false, reason: 'daily_cap' };
  return { ok: true };
}

/** Append one audit-log row per proactive DM. Best-effort; never throws. */
export async function logProactiveSend(
  db: SupabaseClient,
  row: {
    workspaceId: string;
    campaignId?: string | null;
    contactId?: string | null;
    kind: 'outreach' | 'batch' | 'closer' | 'approval';
    text?: string | null;
  },
): Promise<void> {
  await db
    .from('ig_proactive_log')
    .insert({
      workspace_id: row.workspaceId,
      campaign_id: row.campaignId ?? null,
      contact_id: row.contactId ?? null,
      kind: row.kind,
      text: (row.text ?? '').slice(0, 1000) || null,
    })
    .then(
      () => {},
      () => {},
    );
}
