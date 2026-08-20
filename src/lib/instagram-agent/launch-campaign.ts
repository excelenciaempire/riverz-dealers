import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAudience } from './resolve-audience';
import { coercePlan } from './types';

/**
 * Lanzar (o retomar) una campaña de prospección.
 *
 * Estaba entero dentro del POST del route, que resolvía el permiso por RLS: con
 * el cliente de servicio —el del chat agéntico y el del MCP— no hay RLS, así
 * que el recorte por cuenta tiene que ser explícito. De ahí `workspaceId`: si
 * viene, la campaña se busca acotada a esa cuenta y no se puede lanzar la de
 * otro comercio escribiendo su id.
 *
 * No envía nada por sí mismo: encola y deja la campaña activa. Los DMs los
 * manda el worker (`sendCampaignBatch`).
 */

export type LaunchFailure =
  | 'not_found'
  | 'already_done'
  | 'no_valid_plan'
  | 'no_audience';

export type LaunchResult =
  | { ok: true; status: 'active'; queued: number }
  | { ok: false; code: LaunchFailure }
  /** Falla técnica (base o audiencia). `message` vacío = motivo desconocido. */
  | { ok: false; code: 'error'; message: string };

export async function launchCampaign(
  db: SupabaseClient,
  campaignId: string,
  opts: { workspaceId?: string | null } = {},
): Promise<LaunchResult> {
  let query = db
    .from('instagram_campaigns')
    .select('id, workspace_id, plan, status, holdout_pct')
    .eq('id', campaignId);
  if (opts.workspaceId) query = query.eq('workspace_id', opts.workspaceId);

  const { data: campaign, error } = await query.maybeSingle();
  if (error) return { ok: false, code: 'error', message: error.message };
  if (!campaign) return { ok: false, code: 'not_found' };

  const row = campaign as {
    id: string;
    workspace_id: string;
    plan: unknown;
    status: string;
    holdout_pct: number;
  };
  if (row.status === 'done') return { ok: false, code: 'already_done' };

  // Resolver audiencia si no queda NADIE en cola. Contar todas las filas (y no
  // solo las `queued`) dejaba campañas activas sin nada que enviar: bastaba con
  // que sus destinatarios estuvieran ya enviados, descartados o en aprobación
  // para que el lanzamiento no resolviera audiencia nueva y el worker girara en
  // vacío para siempre. El upsert de resolveAudience es idempotente, así que
  // volver a resolver no duplica a nadie.
  const [{ count: queuedCount }, { count: totalCount }] = await Promise.all([
    db
      .from('instagram_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', row.id)
      .eq('status', 'queued'),
    db
      .from('instagram_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', row.id),
  ]);

  let queued = queuedCount ?? 0;
  const hadRecipients = (totalCount ?? 0) > 0;
  if (queued === 0) {
    const plan = coercePlan(row.plan);
    if (!plan) return { ok: false, code: 'no_valid_plan' };
    try {
      const result = await resolveAudience(db, {
        id: row.id,
        workspace_id: row.workspace_id,
        plan,
        holdout_pct: row.holdout_pct,
      });
      queued = result.queued;
    } catch (err) {
      return {
        ok: false,
        code: 'error',
        message: err instanceof Error ? err.message : '',
      };
    }
    // Sin nadie en cola Y sin historial: no hay campaña que lanzar. Con
    // historial (todo ya enviado/atendido) sí activamos: la campaña sigue
    // atribuyendo ventas e inscribiendo en tiempo real a quien comente ahora.
    if (queued === 0 && !hadRecipients) return { ok: false, code: 'no_audience' };
  }

  const { error: updErr } = await db
    .from('instagram_campaigns')
    .update({ status: 'active', launched_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updErr) return { ok: false, code: 'error', message: updErr.message };

  return { ok: true, status: 'active', queued };
}
