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
  const cap = audienceCap(campaign.plan.audience.estimated_reach);
  const { merged } = await listAudienceContacts(
    supabase,
    campaign.workspace_id,
    cap,
  );
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
 * Tope de destinatarios de una campaña. El plan lo estima y acá se acota: sin
 * el máximo, un plan que se entusiasma pidiendo 50.000 personas encolaría una
 * consulta enorme para una audiencia que no existe.
 */
export function audienceCap(estimatedReach: number | undefined): number {
  return Math.max(1, Math.min(2000, estimatedReach || 200));
}

export interface AudienceBreakdown {
  /** La audiencia final, ya unida y deduplicada, respetando el tope. */
  merged: AudienceContact[];
  /** Cuántos aportó cada fuente ANTES de deduplicar. */
  subscribers: number;
  commenters: number;
  dmers: number;
}

/**
 * A quién alcanza hoy una campaña, sin escribir nada.
 *
 * Está separado de `resolveAudience` porque contestar "¿a cuánta gente le
 * llegaría esto?" no puede tener el efecto de encolarla: el chat responde esa
 * pregunta antes de que nadie apruebe nada, y calcularla con la función que
 * persiste dejaría destinatarios creados por el solo hecho de preguntar.
 *
 * Tres fuentes, en orden de preferencia:
 *
 *  1. SUSCRIPTORES — dieron permiso de Marketing Messages, así que se les
 *     puede escribir aunque hayan interactuado hace meses. Van primero
 *     porque son los únicos que no dependen de que la persona haya hecho
 *     algo esta semana: es la lista que crece sola y le saca a la campaña
 *     el techo de "sólo quien comentó hace poco".
 *  2. Comentaristas de los últimos 7 días (respuesta privada).
 *  3. Quien escribió por DM en las últimas 24 h.
 *
 * Encolar el histórico completo sin ninguno de estos tres títulos llenaba la
 * campaña de destinatarios que morían al instante como "fuera de ventana" y
 * hacía ver el embudo roto.
 */
export async function listAudienceContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  cap: number,
): Promise<AudienceBreakdown> {
  const [subscribers, commenters, dmers] = await Promise.all([
    fetchSubscribers(supabase, workspaceId, cap),
    fetchReachableByChannel(supabase, workspaceId, 'ig_comment', cap),
    fetchReachableByChannel(supabase, workspaceId, 'instagram', cap),
  ]);

  return {
    merged: mergeAudience([...subscribers, ...commenters], dmers, cap),
    subscribers: subscribers.length,
    commenters: commenters.length,
    dmers: dmers.length,
  };
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
 * Contactos con permiso de Marketing Messages vigente y sin cooldown.
 *
 * A diferencia de las otras dos fuentes, acá no hay ventana que expire: la
 * persona dio permiso una vez y sigue siendo contactable. Los que todavía
 * están dentro de las 48 h desde el último envío se quedan afuera — el tope es
 * de Meta y encolarlos sólo produce fallos.
 */
async function fetchSubscribers(
  supabase: SupabaseClient,
  workspaceId: string,
  cap: number,
): Promise<AudienceContact[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('meta_marketing_optins')
    .select('contact_id, external_contact_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .or(`next_eligible_at.is.null,next_eligible_at.lte.${nowIso}`)
    .limit(cap);

  const rows = (data ?? []) as Array<{
    contact_id: string | null;
    external_contact_id: string | null;
  }>;
  if (rows.length === 0) return [];

  // El permiso llega por webhook con el id de Meta y nada más, así que
  // `contact_id` puede venir vacío (el contacto todavía no existía, o el
  // webhook ganó la carrera). Exigir esa columna dejaba la lista SIEMPRE en
  // cero mientras la pantalla seguía contando suscriptores: la funcionalidad
  // entera se veía encendida sin encolar a nadie. Se resuelve por el id de
  // Meta, que es lo que siempre está.
  const resolved: AudienceContact[] = [];
  const pendingExternal: string[] = [];
  for (const r of rows) {
    if (r.contact_id) resolved.push({ id: r.contact_id, external_id: r.external_contact_id });
    else if (r.external_contact_id) pendingExternal.push(r.external_contact_id);
  }

  if (pendingExternal.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, external_id')
      .eq('workspace_id', workspaceId)
      .in('external_id', pendingExternal.slice(0, cap));
    for (const c of (contacts ?? []) as AudienceContact[]) {
      resolved.push({ id: c.id, external_id: c.external_id });
    }
  }

  // Un mismo contacto puede haber aceptado más de un tema.
  const seen = new Set<string>();
  return resolved.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/**
 * Une las audiencias priorizando la primera lista y deduplicando por id,
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
