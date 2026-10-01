import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Una sola barrera contra los mensajes duplicados que salen de Riverz.
 *
 * El problema no es un par de crons que se pisan: es que cada flujo
 * proactivo lleva su propio antispam sobre su propia tabla y ninguno ve lo
 * que hicieron los otros. Carrito abandonado mira
 * `shopify_checkouts.recovery_dispatched_at`; pagos rechazados mira
 * `mp_rejected_payments.contacted_at`; reactivación tiene su cooldown;
 * campañas no mira nada. Cada uno cree ser el único que le habla al
 * cliente, y por separado todos tienen razón.
 *
 * Acá se pregunta lo único que importa desde el lado del cliente: **¿le
 * escribimos nosotros hace poco?** La señal es el envío de PLANTILLA. En
 * WhatsApp una plantilla es, por definición, un mensaje que iniciamos
 * nosotros: dentro de la ventana de 24h se responde con texto libre, y
 * fuera sólo se puede mandar plantilla. Así que un mensaje saliente con
 * `template_name` y estado de envío confirmado son la señal de contacto,
 * sin importar qué flujo lo originó. Las campañas también se ven mediante
 * sus comprobantes aceptados cuando no se abrió una conversación.
 *
 * No mira el canal ni el motivo a propósito. Al que recibe no le importa
 * que un mensaje venga del cron de carritos y el otro del de pagos: le
 * llegaron dos cosas parecidas seguidas y eso es lo que molesta.
 */

/**
 * Ventana por defecto. 24h es el mismo horizonte que usa Meta para la
 * ventana de servicio, y es el lapso dentro del cual dos avisos de
 * recuperación se leen como insistencia y no como dos temas distintos.
 */
export const OUTREACH_COOLDOWN_HOURS = 24

export interface OutreachCheck {
  /** true = ya se le escribió; el flujo que pregunta debe abstenerse. */
  blocked: boolean
  /** Cuándo salió el último, para poder dejarlo registrado. */
  at: string | null
  /** Qué plantilla fue, para que el motivo del salteo sea auditable. */
  template: string | null
}

const CLEAR: OutreachCheck = { blocked: false, at: null, template: null }

/**
 * ¿Se le mandó a este contacto alguna plantilla en las últimas `withinHours`?
 *
 * Una fuente con error no inventa evidencia; se usa la otra si está disponible.
 * Sin evidencia de ninguna fuente devuelve "libre", como antes. El costo de
 * los dos errores no es simétrico: bloquear de más apaga en silencio toda
 * la recuperación de un comercio y nadie se entera hasta revisar métricas;
 * dejar pasar de más manda un mensaje repetido, que se ve enseguida.
 */
export async function recentlyContacted(
  db: SupabaseClient,
  args: {
    workspaceId: string
    contactId: string
    withinHours?: number
    /** Ids de mensaje a ignorar (el que acaba de mandar quien pregunta). */
    excludeMessageIds?: string[]
  },
): Promise<OutreachCheck> {
  const hours = args.withinHours ?? OUTREACH_COOLDOWN_HOURS
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const campaignReceipts = () => db.from('broadcast_delivery_receipts')
    .select('id,provider_message_id,created_at,broadcast_recipients!inner(contact_id),broadcasts!inner(workspace_id,template_name,voice_note)')
    .eq('workspace_id', args.workspaceId)
    .eq('broadcast_recipients.contact_id', args.contactId)
    .eq('broadcasts.workspace_id', args.workspaceId)
    .is('broadcasts.voice_note', null)
    .eq('state', 'accepted')

  // Query through the conversation relationship so all authorized threads
  // are visible, including contacts with more than fifty conversations.
  const [messages, receipts] = await Promise.all([
    db.from('messages')
      .select('id,message_id,template_name,created_at,conversation:conversations!inner(workspace_id,contact_id)')
      .eq('conversation.workspace_id', args.workspaceId)
      .eq('conversation.contact_id', args.contactId)
      .neq('sender_type', 'customer')
      .in('status', ['sent', 'delivered', 'read'])
      .not('template_name', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false }).limit(5),
    // A confirmed campaign does not require an inbox conversation. Use its
    // original reservation date; repairs can update updated_at without sending.
    campaignReceipts()
      .gte('created_at', since)
      .order('created_at', { ascending: false }).limit(5),
  ])
  const rows = (!messages.error && Array.isArray(messages.data) ? messages.data : []) as unknown as Array<{
    id: string; message_id?: string | null; template_name: string | null; created_at: string
  }>
  const receiptRows = (!receipts.error && Array.isArray(receipts.data) ? receipts.data : []) as unknown as Array<{
    provider_message_id: string; created_at: string; broadcasts: { template_name: string | null }
  }>
  // An inbox repair can create a recent message for an old confirmed send.
  // Resolve its receipt even when that original attempt is outside the window.
  const matchedIds = new Set(receiptRows.map(row => row.provider_message_id))
  const missingIds = [...new Set(rows.flatMap(row => row.message_id && !matchedIds.has(row.message_id) ? [row.message_id] : []))]
  if (missingIds.length) {
    const matching = await campaignReceipts().in('provider_message_id', missingIds).order('created_at', { ascending: false }).limit(5)
    if (!matching.error && Array.isArray(matching.data)) receiptRows.push(...matching.data as unknown as typeof receiptRows)
  }
  const campaignIds = new Set(receiptRows.map(row => row.provider_message_id))
  const exclude = new Set(args.excludeMessageIds ?? [])
  const excludeExternal = new Set(rows.filter(row => exclude.has(row.id)).flatMap(row => row.message_id ? [row.message_id] : []))
  const hits = [
    ...rows.filter(row => !exclude.has(row.id) && (!row.message_id || !campaignIds.has(row.message_id))).map(row => ({ at: row.created_at, template: row.template_name })),
    ...receiptRows.filter(row => !excludeExternal.has(row.provider_message_id) && Date.parse(row.created_at) >= Date.parse(since)).map(row => ({ at: row.created_at, template: row.broadcasts?.template_name ?? null })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const hit = hits[0]
  return hit ? { blocked: true, at: hit.at, template: hit.template } : CLEAR
}
