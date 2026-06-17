import type { SupabaseClient } from '@supabase/supabase-js';
import type { InstagramCampaign } from './types';

/**
 * Materializa la audiencia de una campaña: busca los contactos del workspace
 * que vienen de Instagram (DMs o comentarios) y los encola como
 * instagram_campaign_recipients (status='queued'), respetando el alcance
 * estimado del plan.
 *
 * Heurística del MVP: todo contacto con channel ∈ {instagram, ig_comment} y
 * external_id es alcanzable, priorizando los de actividad más reciente (la
 * ventana de 24h de Meta favorece a quien interactuó hace poco). Una versión
 * futura puede afinar el match contra `audience.source` (post/historia/ad
 * concretos) cuando el webhook persista ese origen por contacto.
 *
 * Idempotente: el upsert sobre (campaign_id, contact_id) evita duplicar
 * destinatarios si se resuelve más de una vez.
 *
 * Funciona tanto con el cliente autenticado (RLS) como con el service-role.
 */
export async function resolveAudience(
  supabase: SupabaseClient,
  campaign: Pick<InstagramCampaign, 'id' | 'workspace_id' | 'plan'> & {
    holdout_pct?: number;
  },
): Promise<{ queued: number; available: number; holdout: number }> {
  const cap = Math.max(
    1,
    Math.min(2000, campaign.plan.audience.estimated_reach || 200),
  );

  // Dos consultas separadas para poder priorizar a los comentaristas
  // (ig_comment) sobre los que solo escribieron por DM: el comentario de alta
  // intención es el entry-point natural del loop comentario→DM. Cada lado
  // ordenado por recencia (la ventana de 24h de Meta favorece lo reciente).
  const [commenters, dmers] = await Promise.all([
    fetchByChannel(supabase, campaign.workspace_id, 'ig_comment', cap),
    fetchByChannel(supabase, campaign.workspace_id, 'instagram', cap),
  ]);

  const merged = mergeAudience(commenters, dmers, cap);
  if (merged.length === 0) return { queued: 0, available: 0, holdout: 0 };

  // Reservar un % como grupo de control (holdout) para medir incrementalidad.
  const holdoutPct = Math.max(0, Math.min(50, campaign.holdout_pct ?? 0));
  let holdout = 0;
  const recipients = merged.map((c) => {
    const isHoldout = holdoutPct > 0 && Math.random() * 100 < holdoutPct;
    if (isHoldout) holdout += 1;
    return {
      campaign_id: campaign.id,
      contact_id: c.id,
      source_external_id: c.external_id,
      status: 'queued' as const,
      is_holdout: isHoldout,
    };
  });

  const { error: upsertErr, count } = await supabase
    .from('instagram_campaign_recipients')
    .upsert(recipients, {
      onConflict: 'campaign_id,contact_id',
      ignoreDuplicates: true,
      count: 'exact',
    });
  if (upsertErr) throw new Error(upsertErr.message);

  return { queued: count ?? recipients.length, available: merged.length, holdout };
}

export interface AudienceContact {
  id: string;
  external_id: string | null;
}

async function fetchByChannel(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: 'instagram' | 'ig_comment',
  cap: number,
): Promise<AudienceContact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, external_id')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .not('external_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(cap);
  if (error) throw new Error(error.message);
  return (data ?? []) as AudienceContact[];
}

/**
 * Une las dos audiencias priorizando comentaristas y deduplicando por id,
 * respetando el tope. Pura (sin IO) para poder testearla.
 */
export function mergeAudience(
  commenters: AudienceContact[],
  dmers: AudienceContact[],
  cap: number,
): AudienceContact[] {
  const seen = new Set<string>();
  const out: AudienceContact[] = [];
  for (const c of [...commenters, ...dmers]) {
    if (out.length >= cap) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
