import type { SupabaseClient } from '@supabase/supabase-js'
import { countryOfPhone } from '@/lib/whatsapp/phone-utils'
import { freshAccessToken } from './oauth'
import { syncWorkspaceRejectedPayments } from './sync'

/**
 * Aviso de pago de Mercado Pago, venga por donde venga.
 *
 * Vive suelto porque le entra por dos puertas y el trabajo es el mismo:
 *
 *   - El webhook de la aplicación de Mercado Libre. Una aplicación tiene UNA
 *     sola URL de notificaciones para todos sus temas, así que los avisos de
 *     `payment` aterrizan en el mismo endpoint que las preguntas y los
 *     mensajes de Mercado Libre. Cambiar esa URL para los pagos rompería el
 *     canal de Mercado Libre: por eso se bifurca por tema en vez de pedir
 *     otra URL.
 *   - `/api/mercadopago/webhook`, para una cuenta que registre una URL propia.
 *
 * Se re-sincroniza una ventana corta en vez de traer sólo ese pago: es la
 * misma ruta que el cron, así que el agrupado por persona, el cruce del
 * teléfono y la detección de "compró igual" salen idénticos. La ingesta es
 * idempotente, de modo que varios avisos del mismo pago no duplican nada.
 */

const WINDOW_DAYS = 1

export interface NotifyResult {
  ok: true
  ignored?: string
  unidentified?: boolean
  disconnected?: boolean
  deferred?: boolean
  inserted?: number
  updated?: number
}

/** ¿Este aviso es de un pago? Los demás temas son de otros canales. */
export function isPaymentTopic(kind: string | undefined | null): boolean {
  return (kind ?? '').toLowerCase() === 'payment'
}

/**
 * @param sellerId `user_id` del vendedor, la única pista del aviso para
 *   saber a qué workspace pertenece.
 */
export async function handlePaymentNotification(
  admin: SupabaseClient,
  sellerId: string,
): Promise<NotifyResult> {
  if (!sellerId) return { ok: true, unidentified: true }

  const { data } = await admin
    .from('workspace_integrations')
    .select('workspace_id')
    .eq('provider', 'mercadopago')
    .eq('external_account_id', sellerId)
    .eq('is_active', true)
    .maybeSingle()

  const workspaceId = (data as { workspace_id: string } | null)?.workspace_id
  // Desconectaron la cuenta pero Mercado Pago sigue avisando.
  if (!workspaceId) return { ok: true, disconnected: true }

  const token = await freshAccessToken(admin, workspaceId)
  if (!token) return { ok: true, deferred: true }

  const { data: conn } = await admin
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .limit(1)
    .maybeSingle()
  const phone = (conn as { config?: { display_phone_number?: string } } | null)
    ?.config?.display_phone_number

  const res = await syncWorkspaceRejectedPayments(admin, {
    workspaceId,
    token,
    windowDays: WINDOW_DAYS,
    defaultCountry: countryOfPhone(phone) ?? 'AR',
  })
  return { ok: true, inserted: res.ingested.inserted, updated: res.ingested.updated }
}
