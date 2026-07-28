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

/**
 * Cómo quiere el comercio que la IA conteste los comentarios (migración 132).
 *
 *   audience 'intent' — solo a quien muestra intención de compra (por defecto,
 *                       la conducta de siempre).
 *   audience 'all'    — a todo el que pregunte. El spam se filtra igual.
 *   maxThreadReplies  — cuántas veces puede contestar en el MISMO hilo antes de
 *                       callarse y dejarlo para una persona. 0 = sin tope.
 *
 * Sin fila de ajustes, los defaults reproducen el comportamiento anterior.
 */
export interface CommentReplySettings {
  audience: 'intent' | 'all';
  maxThreadReplies: number;
  /** Además del DM, publicar una respuesta en el propio comentario. */
  publicReply: boolean;
  /** Contestar también los comentarios de Facebook, no solo los de Instagram. */
  facebook: boolean;
}

export async function loadCommentSettings(
  db: SupabaseClient,
  workspaceId: string,
): Promise<CommentReplySettings> {
  const { data } = await db
    .from('ig_proactive_settings')
    .select(
      'comment_audience, comment_max_thread_replies, comment_public_reply, comment_facebook',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const s = data as {
    comment_audience?: string | null;
    comment_max_thread_replies?: number | null;
    comment_public_reply?: boolean | null;
    comment_facebook?: boolean | null;
  } | null;
  return {
    audience: s?.comment_audience === 'all' ? 'all' : 'intent',
    maxThreadReplies:
      typeof s?.comment_max_thread_replies === 'number'
        ? Math.max(0, s.comment_max_thread_replies)
        : 3,
    publicReply: s?.comment_public_reply === true,
    facebook: s?.comment_facebook === true,
  };
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
  // El tope protege la reputación de ENVÍO de la cuenta, así que cuenta DMs.
  // Una respuesta pública en un comentario no es un DM: si contara, publicar
  // en público consumiría el presupuesto de los privados.
  const { count } = await db
    .from('ig_proactive_log')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .neq('kind', 'comment_public')
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
 *   comment                              — Comentarios: DM de la IA.
 *   comment_rule                         — Comentarios: DM de una regla.
 *   comment_public                       — Comentarios: respuesta PÚBLICA en el
 *                                          propio comentario (no es un DM y no
 *                                          cuenta para el tope).
 *
 * Las reglas llevan además su propio libro (`comment_to_dm_log`, con el estado
 * de la respuesta pública); aquí entran solo para que cuenten en el tope
 * diario, porque el límite protege la reputación de la cuenta y le da igual
 * qué funcionalidad mandó el DM.
 *
 * Las estadísticas nunca mezclan los kinds.
 */
export async function logProactiveSend(
  db: SupabaseClient,
  row: {
    workspaceId: string;
    campaignId?: string | null;
    contactId?: string | null;
    kind:
      | 'outreach'
      | 'batch'
      | 'closer'
      | 'approval'
      | 'comment'
      | 'comment_rule'
      | 'comment_public';
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
