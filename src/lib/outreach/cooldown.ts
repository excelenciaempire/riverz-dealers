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
 * `template_name` es exactamente "interrumpimos a esta persona", sin
 * importar qué flujo lo originó.
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
 * Ante un error de lectura devuelve "libre" en vez de bloquear. El costo de
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

  const { data: convs, error: convErr } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('contact_id', args.contactId)
    .limit(50)
  if (convErr) return CLEAR

  const ids = ((convs ?? []) as { id: string }[]).map((c) => c.id)
  if (ids.length === 0) return CLEAR

  const { data, error } = await db
    .from('messages')
    .select('id, template_name, created_at')
    .in('conversation_id', ids)
    .neq('sender_type', 'customer')
    .not('template_name', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) return CLEAR

  const rows = (data ?? []) as {
    id: string
    template_name: string | null
    created_at: string
  }[]
  const exclude = new Set(args.excludeMessageIds ?? [])
  const hit = rows.find((m) => !exclude.has(m.id))
  if (!hit) return CLEAR

  return { blocked: true, at: hit.created_at, template: hit.template_name }
}
