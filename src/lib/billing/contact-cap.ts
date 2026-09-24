import type { SupabaseClient } from '@supabase/supabase-js'
import { leerSuscripcion } from './plan'
import { periodoDe } from './uso'

/**
 * El límite sólo afecta a personas NUEVAS de los planes públicos. Una persona
 * ya atendida puede seguir conversando aunque el cupo esté lleno. No se cobra
 * jamás un excedente automáticamente.
 */
export async function puedeAtenderContacto(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<boolean> {
  const sus = await leerSuscripcion(db, workspaceId)
  if (!sus || sus.modeloCobro !== 'oficial' || sus.estado === 'cortesia' || sus.incluidas <= 0) return true
  const { desde, hasta } = periodoDe(sus)
  const params = {
    p_workspace: workspaceId,
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
  }
  const { data: objetivo, error: objetivoError } = await db.from('contacts')
    .select('id, unified_contact_id').eq('workspace_id', workspaceId).eq('id', contactId).maybeSingle()
  if (objetivoError || !objetivo) throw objetivoError ?? new Error('Contacto no encontrado.')
  const identidad = objetivo as { id: string; unified_contact_id: string | null }
  const { data: unidos, error: unidosError } = await db.from('contacts')
    .select('id').eq('workspace_id', workspaceId)
    .eq('unified_contact_id', identidad.unified_contact_id ?? contactId)
  if (unidosError) throw unidosError
  const linkedIds = (unidos ?? []).map((row) => row.id as string)
  const ids = [...new Set(
    [contactId, identidad.unified_contact_id, ...linkedIds]
      .filter((id): id is string => Boolean(id)),
  )]
  const { data: atendido, error: atendidoError } = await db.from('billing_contact_events')
    .select('reply_id').eq('workspace_id', workspaceId)
    .in('contact_id', ids).gte('served_at', params.p_desde).lt('served_at', params.p_hasta)
    .limit(1).maybeSingle()
  if (atendidoError) throw atendidoError
  if (atendido) return true
  const { data: total, error: totalError } = await db.rpc('billing_contactos_atendidos', params)
  if (totalError) throw totalError
  return Number(total ?? 0) < sus.incluidas
}
