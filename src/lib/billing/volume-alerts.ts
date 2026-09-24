import type { SupabaseClient } from '@supabase/supabase-js'
import { destinosDeAviso, avisarATodos } from '@/lib/avisos/destinos'
import { enviarCorreo } from '@/lib/admin/correo'
import { localeDeCuenta } from '@/lib/i18n/cuenta'
import { translate } from '@/lib/i18n/translate'
import { leerSuscripcion } from './plan'
import { periodoDe, usoDelPeriodo } from './uso'

export function umbralDeVolumen(contactos: number, incluidas: number): 80 | 95 | 100 | null {
  if (incluidas <= 0) return null
  if (contactos >= incluidas) return 100
  if (contactos >= Math.ceil(incluidas * 0.95)) return 95
  if (contactos >= Math.ceil(incluidas * 0.8)) return 80
  return null
}

/** El cron consulta el registro de contactos, que se actualiza al enviar cada respuesta. */
export async function avisarVolumenOficial(db: SupabaseClient): Promise<{ revisadas: number; avisadas: number }> {
  const { data, error } = await db.from('workspace_subscriptions')
    .select('workspace_id')
    .eq('modelo_cobro', 'oficial')
    .in('estado', ['activa', 'prueba'])
  if (error) throw error

  let avisadas = 0
  for (const { workspace_id: workspaceId } of (data ?? []) as { workspace_id: string }[]) {
    const sus = await leerSuscripcion(db, workspaceId)
    if (!sus || sus.incluidas <= 0) continue
    const periodo = periodoDe(sus)
    const uso = await usoDelPeriodo(db, workspaceId, periodo)
    const umbral = umbralDeVolumen(uso.contactos, sus.incluidas)
    if (!umbral) continue

    // El insert gana la carrera entre dos corridas. Si no sale ningún canal,
    // se libera la marca para intentar de nuevo en la próxima corrida.
    const clave = { workspace_id: workspaceId, period_start: periodo.desde.toISOString(), threshold: umbral }
    const { data: reservado, error: reservaError } = await db.from('billing_volume_alerts')
      .upsert(clave, { onConflict: 'workspace_id,period_start,threshold', ignoreDuplicates: true })
      .select('workspace_id')
    // La migración 270 amplía el CHECK a 95. Si todavía no llegó al proyecto,
    // se preservan los avisos de 80 y 100 sin romper el cron entero.
    if (umbral === 95 && reservaError?.code === '23514') continue
    if (reservaError) throw reservaError
    if (!reservado?.length) continue

    try {
      const locale = await localeDeCuenta(db, workspaceId)
      const vars = { n: uso.contactos, total: sus.incluidas }
      const title = translate(locale, umbral === 100 ? 'settings.billingLimitTitle' : 'settings.billingNearTitle')
      const body = translate(locale, umbral === 100 ? 'settings.billingLimitMessage' : 'settings.billingNearMessage', vars)
      const [{ data: ws }, phones] = await Promise.all([
        db.from('workspaces').select('owner_id').eq('id', workspaceId).maybeSingle(),
        destinosDeAviso(db, workspaceId, 'plata'),
      ])
      const ownerId = (ws as { owner_id?: string | null } | null)?.owner_id
      const { data: profile } = ownerId
        ? await db.from('profiles').select('email').eq('user_id', ownerId).maybeSingle()
        : { data: null }
      const email = (profile as { email?: string | null } | null)?.email
      const [whatsapp, correo] = await Promise.all([
        phones.length ? avisarATodos(phones, { title, body }) : Promise.resolve({ ok: false }),
        email ? enviarCorreo(email, title, body) : Promise.resolve(false),
      ])
      if (!whatsapp.ok && !correo) throw new Error('sin canal de aviso disponible')
      avisadas++
    } catch (err) {
      const { error: releaseError } = await db.from('billing_volume_alerts').delete()
        .eq('workspace_id', workspaceId)
        .eq('period_start', clave.period_start)
        .eq('threshold', umbral)
      if (releaseError) console.error('[billing/volume-alerts] no se pudo liberar el aviso', workspaceId, releaseError)
      console.error('[billing/volume-alerts] aviso no enviado', workspaceId, err)
    }
  }
  return { revisadas: data?.length ?? 0, avisadas }
}
