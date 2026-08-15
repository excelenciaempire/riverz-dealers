import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { markOrderPaid } from '@/lib/shopify/mark-paid'

/**
 * La vuelta del humano en el medio: qué pasa cuando el comercio contesta.
 *
 * La respuesta llega por WhatsApp como texto ("SI a1b2c3") o desde el panel.
 * Acá se interpreta, se marca la decisión y —si dijo que sí— se ejecuta lo
 * que estaba esperando.
 *
 * Todo pasa por `decidir()`: el panel y el WhatsApp no pueden divergir, y una
 * pregunta contestada dos veces se ejecuta una sola.
 */

export type Decision = 'aprobada' | 'rechazada'

/** "SI a1b2c3" / "no A1B2C3" → la decisión y el código. */
export function parseReply(text: string): { decision: Decision; code: string } | null {
  const m = /^\s*(s[ií]|no)\s+([0-9a-f]{6})\s*$/i.exec(text ?? '')
  if (!m) return null
  return {
    decision: /^s/i.test(m[1]) ? 'aprobada' : 'rechazada',
    code: m[2].toLowerCase(),
  }
}

export interface ResolveResult {
  ok: boolean
  /** Qué contarle a quien contestó. */
  message: string
  approvalId?: string
}

/**
 * Busca la pregunta por su código corto y la resuelve.
 *
 * El código son los 6 primeros caracteres del id. Alcanza: sólo se busca
 * entre las pendientes y sin vencer de ese teléfono, así que el universo son
 * dos o tres, no un millón.
 */
export async function resolveByCode(
  db: SupabaseClient,
  args: { code: string; decision: Decision; phone?: string | null },
): Promise<ResolveResult> {
  const { data } = await db
    .from('approval_requests')
    .select('id, workspace_id, kind, payload, status, expires_at, title')
    .eq('status', 'pendiente')
    .order('created_at', { ascending: false })
    .limit(50)
  const filas = (data ?? []) as {
    id: string
    workspace_id: string
    kind: string
    payload: Record<string, unknown>
    status: string
    expires_at: string
    title: string
  }[]
  const fila = filas.find((f) => f.id.slice(0, 6).toLowerCase() === args.code)
  if (!fila) {
    return { ok: false, message: 'No encontré ninguna decisión pendiente con ese código.' }
  }
  if (Date.parse(fila.expires_at) < Date.now()) {
    await db
      .from('approval_requests')
      .update({ status: 'vencida', decided_at: new Date().toISOString() })
      .eq('id', fila.id)
    return { ok: false, message: 'Esa decisión ya venció. Vuelve a mirarla desde el panel.' }
  }

  return decidir(db, {
    approvalId: fila.id,
    decision: args.decision,
    via: 'whatsapp',
  })
}

/**
 * Marca la decisión y ejecuta lo que corresponda.
 *
 * El UPDATE condicionado a `status = 'pendiente'` es lo que evita que dos
 * respuestas —el WhatsApp y el panel, o dos mensajes seguidos— ejecuten la
 * misma acción dos veces: la segunda no encuentra fila que actualizar.
 */
export async function decidir(
  db: SupabaseClient,
  args: {
    approvalId: string
    decision: Decision
    via: 'whatsapp' | 'panel'
    decidedBy?: string | null
  },
): Promise<ResolveResult> {
  const { data, error } = await db
    .from('approval_requests')
    .update({
      status: args.decision,
      decided_at: new Date().toISOString(),
      decided_via: args.via,
      decided_by: args.decidedBy ?? null,
    })
    .eq('id', args.approvalId)
    .eq('status', 'pendiente')
    .select('id, workspace_id, kind, payload, title')
    .maybeSingle()
  if (error) return { ok: false, message: `No se pudo registrar: ${error.message}` }
  if (!data) {
    return { ok: false, message: 'Esa decisión ya estaba resuelta.' }
  }
  const fila = data as {
    id: string
    workspace_id: string
    kind: string
    payload: Record<string, unknown>
    title: string
  }

  if (args.decision === 'rechazada') {
    await db
      .from('approval_requests')
      .update({ result: 'rechazada por una persona' })
      .eq('id', fila.id)
    return { ok: true, message: 'Listo, no se hizo nada.', approvalId: fila.id }
  }

  const ejecucion = await ejecutar(db, fila)
  await db
    .from('approval_requests')
    .update({
      result: ejecucion.message,
      status: ejecucion.ok ? 'aprobada' : 'fallida',
    })
    .eq('id', fila.id)
  return { ...ejecucion, approvalId: fila.id }
}

/** Lo que hace cada clase de pregunta cuando dicen que sí. */
async function ejecutar(
  db: SupabaseClient,
  fila: { workspace_id: string; kind: string; payload: Record<string, unknown> },
): Promise<ResolveResult> {
  switch (fila.kind) {
    case 'pago_informado': {
      const orderId = String(fila.payload.order_id ?? '')
      const shopifyOrderId = String(fila.payload.shopify_order_id ?? '')
      if (!shopifyOrderId) {
        return { ok: false, message: 'El pedido no está en Shopify: márcalo a mano.' }
      }
      const admin = await resolveShopifyAdmin(db, fila.workspace_id)
      if (!admin) return { ok: false, message: 'La tienda no está conectada.' }
      const res = await markOrderPaid(admin, shopifyOrderId)
      if (!res.ok) return { ok: false, message: res.error ?? 'Shopify no aceptó el cobro.' }
      if (orderId) {
        await db
          .from('orders')
          .update({
            financial_status: res.financialStatus ?? 'paid',
            payment_report_outcome: 'aprobado',
          })
          .eq('id', orderId)
      }
      return { ok: true, message: 'Pedido marcado como pagado en Shopify.' }
    }
    default:
      return { ok: false, message: `No sé cómo ejecutar "${fila.kind}".` }
  }
}
