import type { SupabaseClient } from '@supabase/supabase-js';
import type { InstagramCampaign } from './types';
import { MESSAGING_WINDOW_MS, COMMENT_WINDOW_MS } from './engagement';

/**
 * Materializa la audiencia de una campaña: busca los contactos del workspace
 * que vienen de Instagram (DMs o comentarios) y los encola como
 * instagram_campaign_recipients (status='queued'), respetando el alcance
 * estimado del plan.
 *
 * Solo entra quien tiene una ventana de Meta ABIERTA: comentaristas de los
 * últimos 7 días (respuesta privada) y quien escribió por DM en las últimas
 * 24h. Se priorizan los comentaristas (el comentario de alta intención es el
 * entry-point natural del loop comentario→DM) y, dentro de cada grupo, los más
 * recientes. Una versión futura puede afinar el match contra `audience.source`
 * (post/historia/ad concretos) cuando el webhook persista ese origen.
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

  // Solo gente con una ventana de Meta ABIERTA: comentaristas de los últimos 7
  // días (respuesta privada) y quien escribió por DM (ventana de 24h). Encolar
  // el histórico completo llenaba la campaña de destinatarios que morían al
  // instante como "fuera de ventana" y hacía ver el embudo roto.
  const [commenters, dmers] = await Promise.all([
    fetchReachableByChannel(supabase, campaign.workspace_id, 'ig_comment', cap),
    fetchReachableByChannel(supabase, campaign.workspace_id, 'instagram', cap),
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

/**
 * Contactos de un canal de Instagram con actividad dentro de su ventana de
 * Meta: 24h para DMs, 7 días para comentarios. Ordenados por recencia — quien
 * interactuó hace menos convierte más y le queda más ventana.
 */
async function fetchReachableByChannel(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: 'instagram' | 'ig_comment',
  cap: number,
): Promise<AudienceContact[]> {
  const windowMs = channel === 'instagram' ? MESSAGING_WINDOW_MS : COMMENT_WINDOW_MS;
  const since = new Date(Date.now() - windowMs).toISOString();

  const { data: convs, error: convErr } = await supabase
    .from('conversations')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .gt('last_message_at', since)
    .not('contact_id', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(cap * 2);
  if (convErr) throw new Error(convErr.message);

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of (convs ?? []) as Array<{ contact_id: string }>) {
    if (seen.has(row.contact_id)) continue;
    seen.add(row.contact_id);
    ids.push(row.contact_id);
    if (ids.length >= cap) break;
  }
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('contacts')
    .select('id, external_id')
    .in('id', ids)
    .not('external_id', 'is', null);
  if (error) throw new Error(error.message);

  // Conservar el orden por recencia que trajo la consulta de conversaciones.
  const byId = new Map(
    ((data ?? []) as AudienceContact[]).map((c) => [c.id, c]),
  );
  return ids.map((id) => byId.get(id)).filter((c): c is AudienceContact => Boolean(c));
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
