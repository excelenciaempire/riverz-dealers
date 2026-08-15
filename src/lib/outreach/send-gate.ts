import type { SupabaseClient } from '@supabase/supabase-js'
import { recentlyContacted } from './cooldown'
import { assertWithinTierCap, resolveWhatsAppConnectionId } from '@/lib/whatsapp/tier-cap'

/**
 * El portón de salida: lo único que decide si un mensaje puede irse.
 *
 * Antes, cada emisor traía sus propias barreras. El motor de automatizaciones
 * chequeaba credenciales y el gate de marketing a EE.UU.; el cron de carritos
 * sumaba enfriamiento y dedupe; el de pagos sumaba baja y anti-recontacto; las
 * campañas miraban el cupo de la WABA; los seguimientos de la IA miraban la
 * ventana de 24 h. Ninguno tenía la lista completa, así que el mismo cliente
 * estaba protegido o no según por qué puerta saliera el mensaje.
 *
 * El agujero que eso dejaba es el que más importa: **el motor nunca miró la
 * baja del cliente**. Una automatización disparada por un webhook de Shopify
 * —confirmación de pedido, tracking, recordatorio de pago— le escribía igual
 * a quien había puesto STOP, porque quien miraba `opted_out` era el cron, y
 * esas automatizaciones no pasan por ningún cron.
 *
 * Acá vive esa lista, una sola vez, y todos los emisores la consultan.
 */

export type SendKind = 'template' | 'text'

/**
 * Por qué sale este mensaje. No es decorativo: decide cuál barrera aplica.
 *
 *   transaccional — algo pasó y hay que avisar (pedido confirmado, despacho,
 *     recordatorio del mismo pedido). No se enfría: son varios mensajes del
 *     mismo hilo y callarlos deja al cliente sin la información que espera.
 *   rescate — sale a buscar una venta que no se cerró (carrito, pago
 *     rechazado). Se enfría para no insistirle dos veces por lo mismo.
 *   campana — envío masivo decidido por el comercio.
 *   asistente — lo escribe la IA dentro de una conversación.
 */
export type SendReason = 'transaccional' | 'rescate' | 'campana' | 'asistente'

export type SendBarrier = 'baja' | 'enfriamiento' | 'ventana_24h' | 'cupo_waba'

export interface SendGateInput {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  kind: SendKind
  reason: SendReason
  /**
   * Horas del enfriamiento compartido. `undefined` usa el default del motivo
   * (0 para transaccional, 24 para el resto); `0` lo apaga explícitamente.
   */
  cooldownHours?: number
  /** Cuántos destinatarios suma esta llamada al cupo de la WABA. */
  recipients?: number
}

export type SendGateVerdict =
  | { allow: true }
  | { allow: false; barrier: SendBarrier; detail: string }

const DEFAULT_COOLDOWN: Record<SendReason, number> = {
  transaccional: 0,
  rescate: 24,
  campana: 0,
  asistente: 0,
}

/** Ventana de servicio de Meta: fuera de ella sólo entran plantillas. */
const META_WINDOW_HOURS = 24

/**
 * ¿Puede salir este mensaje?
 *
 * Nunca lanza: devuelve el motivo del freno para que quien llama lo registre
 * con nombre propio en vez de un fallo genérico.
 */
export async function checkSendGate(input: SendGateInput): Promise<SendGateVerdict> {
  const baja = await pidioLaBaja(input.db, input.workspaceId, input.contactId)
  if (baja.optedOut) {
    return {
      allow: false,
      barrier: 'baja',
      detail: baja.reason ?? 'el contacto pidió no recibir más mensajes',
    }
  }

  const horas = input.cooldownHours ?? DEFAULT_COOLDOWN[input.reason]
  if (horas > 0) {
    const hit = await recentlyContacted(input.db, {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      withinHours: horas,
    })
    if (hit.blocked) {
      return {
        allow: false,
        barrier: 'enfriamiento',
        detail: `ya se le envió ${hit.template ?? 'una plantilla'} en las últimas ${horas} h`,
      }
    }
  }

  // Texto libre fuera de la ventana de servicio: Meta lo rechaza igual, pero
  // frenarlo acá deja el motivo escrito en vez de un error de la API.
  if (input.kind === 'text') {
    const abierta = await ventanaAbierta(input.db, input.contactId)
    if (!abierta) {
      return {
        allow: false,
        barrier: 'ventana_24h',
        detail: 'pasaron más de 24 h desde el último mensaje del cliente: sólo entra una plantilla',
      }
    }
  }

  // El cupo de la WABA sólo cuenta conversaciones que abrimos nosotros, que
  // es lo que hace una plantilla.
  if (input.kind === 'template') {
    const connId = await resolveWhatsAppConnectionId(input.db, input.workspaceId)
    if (connId) {
      const cupo = await assertWithinTierCap(input.db, connId, input.recipients ?? 1)
      if (!cupo.allowed) {
        return {
          allow: false,
          barrier: 'cupo_waba',
          detail: cupo.reason ?? `cupo ${cupo.tier} alcanzado (${cupo.sent24h}/${cupo.cap})`,
        }
      }
    }
  }

  return { allow: true }
}

/**
 * ¿Pidió la baja?
 *
 * A diferencia del resto, esta barrera falla CERRADA: si la consulta no
 * responde, se asume que sí. Es la única del portón que no es una cuestión de
 * criterio sino de consentimiento — mandarle a quien dijo que no se arregla
 * pidiendo perdón, y no mandar durante una caída de la base se arregla solo
 * cuando la base vuelve. El `isOptedOut` de opt-out.ts hace lo contrario
 * (ignora el error y deja pasar); por eso esto vive acá.
 */
async function pidioLaBaja(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<{ optedOut: boolean; reason?: string }> {
  const { data, error } = await db
    .from('contacts')
    .select('opted_out, opted_out_reason')
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) {
    return { optedOut: true, reason: `no se pudo verificar la baja: ${error.message}` }
  }
  const row = data as { opted_out?: boolean; opted_out_reason?: string | null } | null
  if (!row) return { optedOut: false }
  return {
    optedOut: Boolean(row.opted_out),
    reason: row.opted_out_reason ?? undefined,
  }
}

/** ¿El cliente escribió en las últimas 24 h? */
async function ventanaAbierta(db: SupabaseClient, contactId: string): Promise<boolean> {
  const desde = new Date(Date.now() - META_WINDOW_HOURS * 3_600_000).toISOString()
  const { data, error } = await db
    .from('contacts')
    .select('last_inbound_at')
    .eq('id', contactId)
    .maybeSingle()
  // Sin dato no se adivina: se deja pasar y que Meta decida, como hasta ahora.
  if (error) return true
  const last = (data as { last_inbound_at?: string | null } | null)?.last_inbound_at
  if (!last) return false
  return last >= desde
}
