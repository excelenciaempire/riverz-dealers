import type { SupabaseClient } from '@supabase/supabase-js'
import { leerSuscripcion } from './plan'
import { periodoDe } from './uso'

/**
 * El límite sólo afecta a personas NUEVAS de los planes públicos. Una persona
 * ya atendida puede seguir conversando aunque el cupo esté lleno. La reserva
 * serializada evita que dos canales admitan a la vez al último contacto.
 * Una reserva sin respuesta expira a los 15 minutos; nunca genera un cobro.
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
    p_contact: contactId,
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
    p_limite: sus.incluidas,
  }
  const { data, error } = await db.rpc('billing_try_reserve_contact', params)
  if (error) throw error
  return data === true
}
