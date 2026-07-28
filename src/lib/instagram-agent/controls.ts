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

/**
 * Cada funcionalidad se prende y se apaga por su cuenta, como los agentes.
 * Sin fila de ajustes, todo está encendido (el default de las columnas).
 *
 *   comments — responder los comentarios (incluye el piso autónomo).
 *   outreach — salir a buscar: inscribir gente en campañas y enviarles.
 *
 * `paused` (el freno de emergencia) manda sobre las dos y se comprueba aparte,
 * en proactiveGate, junto con el tope diario.
 */
export type IgFeature = 'comments' | 'outreach';

export async function featureEnabled(
  db: SupabaseClient,
  workspaceId: string,
  feature: IgFeature,
): Promise<boolean> {
  const column =
    feature === 'comments' ? 'auto_reply_comments' : 'outreach_enabled';
  const { data } = await db
    .from('ig_proactive_settings')
    .select(column)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data as Record<string, boolean> | null)?.[column] !== false;
}

/** ¿Está encendido el piso autónomo (responder comentarios sin campaña)? */
export async function autoReplyCommentsEnabled(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  return featureEnabled(db, workspaceId, 'comments');
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

/**
 * Append one audit-log row per proactive DM. Best-effort; never throws.
 *
 * `kind` dice QUIÉN mandó el DM, y de ahí salen las cifras de cada pantalla:
 *
 *   outreach | batch | closer | approval — Prospección IA (campañas).
 *   comment                              — Comentarios: la IA contestando un
 *                                          comentario sin campaña de por medio.
 *
 * Los DMs de una regla no pasan por aquí: llevan su propio libro
 * (`comment_to_dm_log`), que además guarda si la respuesta pública salió.
 *
 * El tope diario cuenta todos los kinds —es un límite de reputación de la
 * cuenta, no de una funcionalidad—, pero las estadísticas nunca los mezclan.
 */
export async function logProactiveSend(
  db: SupabaseClient,
  row: {
    workspaceId: string;
    campaignId?: string | null;
    contactId?: string | null;
    kind: 'outreach' | 'batch' | 'closer' | 'approval' | 'comment';
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
