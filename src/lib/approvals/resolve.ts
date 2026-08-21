import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { markOrderPaid } from '@/lib/shopify/mark-paid'
import { cancelOrder, refundOrder } from '@/lib/shopify/order-cancel'

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
 * El código son los 6 primeros caracteres del id, y **por sí solo no autoriza
 * nada**: la búsqueda se acota primero al teléfono al que se le preguntó. Antes
 * no era así — se barrían las 50 pendientes más nuevas de TODA la plataforma y
 * se elegía por prefijo — con dos consecuencias: cualquiera que acertara seis
 * caracteres resolvía la decisión de otro comercio, y pasadas las 50 pendientes
 * los códigos legítimos dejaban de encontrarse.
 *
 * El teléfono se compara por los últimos 8 dígitos, como en el resto del
 * código: lo que guarda `notified_phone` y lo que manda Meta en `from` pueden
 * diferir en el prefijo (el clásico 54911… contra 5411… de Argentina).
 */
export async function resolveByCode(
  db: SupabaseClient,
  args: { code: string; decision: Decision; phone?: string | null },
): Promise<ResolveResult> {
  const ultimos8 = (args.phone ?? '').replace(/\D/g, '').slice(-8)
  if (ultimos8.length < 8) {
    return { ok: false, message: 'No encontré ninguna decisión pendiente con ese código.' }
  }

  const { data } = await db
    .from('approval_requests')
    .select('id, workspace_id, kind, payload, status, expires_at, title')
    .eq('status', 'pendiente')
    .like('notified_phone', `%${ultimos8}`)
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
    workspaceId: fila.workspace_id,
  })
}

/**
 * Marca la decisión y ejecuta lo que corresponda.
 *
 * El UPDATE condicionado a `status = 'pendiente'` es lo que evita que dos
 * respuestas —el WhatsApp y el panel, o dos mensajes seguidos— ejecuten la
 * misma acción dos veces: la segunda no encuentra fila que actualizar.
 *
 * `workspaceId` es la barrera de cuenta y se pasa siempre que quien decide
 * llegó por una vía atada a un comercio (el panel, o el MCP con su
 * workspace_id). Sin él, un id de aprobación suelto alcanzaba para aprobar algo
 * de otra cuenta — y aprobar ejecuta: marca un pedido como pagado en Shopify.
 */
export async function decidir(
  db: SupabaseClient,
  args: {
    approvalId: string
    decision: Decision
    via: 'whatsapp' | 'panel'
    decidedBy?: string | null
    workspaceId?: string | null
  },
): Promise<ResolveResult> {
  let q = db
    .from('approval_requests')
    .update({
      status: args.decision,
      decided_at: new Date().toISOString(),
      decided_via: args.via,
      decided_by: args.decidedBy ?? null,
    })
    .eq('id', args.approvalId)
    .eq('status', 'pendiente')
  if (args.workspaceId) q = q.eq('workspace_id', args.workspaceId)
  const { data, error } = await q
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
          .eq('workspace_id', fila.workspace_id)
      }
      return { ok: true, message: 'Pedido marcado como pagado en Shopify.' }
    }
    case 'cancelar_pedido':
    case 'reembolsar_pedido': {
      const shopifyOrderId = String(fila.payload.shopify_order_id ?? '')
      const orderId = String(fila.payload.order_id ?? '')
      if (!shopifyOrderId) {
        return { ok: false, message: 'El pedido no está en Shopify: resolvelo a mano.' }
      }
      const admin = await resolveShopifyAdmin(db, fila.workspace_id)
      if (!admin) return { ok: false, message: 'La tienda no está conectada.' }

      const cancelando = fila.kind === 'cancelar_pedido'
      const res = cancelando
        ? await cancelOrder(admin, shopifyOrderId, {
            reason: String(fila.payload.reason ?? 'customer'),
          })
        : await refundOrder(admin, shopifyOrderId, {
            amount:
              typeof fila.payload.amount === 'number' ? fila.payload.amount : undefined,
            reason: (fila.payload.reason as string | null) ?? undefined,
          })

      if (!res.ok) {
        // El caso con arreglo se nombra: la tienda se conectó antes de que el
        // set de permisos incluyera escritura y hay que reconectarla.
        if (res.error === 'missing_write_scope') {
          return {
            ok: false,
            message: 'Falta permiso de escritura en Shopify. Reconectá la tienda y volvé a intentar.',
          }
        }
        if (res.error === 'sin_cobro_registrado') {
          return {
            ok: false,
            message: 'Ese pedido no tiene un cobro registrado en Shopify: devolvé el dinero por donde entró.',
          }
        }
        if (res.error === 'monto_mayor_al_cobrado') {
          return {
            ok: false,
            message: 'El importe pedido supera lo que se cobró de ese pedido. No se devolvió nada.',
          }
        }
        return { ok: false, message: res.error ?? 'Shopify no aceptó la operación.' }
      }

      // El espejo se actualiza igual: el webhook de Shopify también va a
      // llegar, pero puede tardar, y hasta entonces el pedido seguiría
      // figurando activo en Riverz — justo mientras alguien mira si funcionó.
      if (orderId) {
        await db
          .from('orders')
          .update(
            cancelando
              ? { status: 'cancelled', financial_status: res.financialStatus ?? 'refunded' }
              : { financial_status: 'refunded' },
          )
          .eq('id', orderId)
          .eq('workspace_id', fila.workspace_id)
      }

      // El texto dice lo que Shopify informó, no lo que se pidió. Afirmar
      // "dinero devuelto" sin mirar el estado hacía que el comercio cerrara el
      // caso —y se lo transmitiera a la clienta— cuando el pedido había quedado
      // cancelado sin devolver nada.
      const devuelto = res.financialStatus === 'refunded'
      return {
        ok: true,
        message: cancelando
          ? devuelto
            ? 'Pedido cancelado y dinero devuelto en Shopify.'
            : `Pedido cancelado en Shopify. El pago quedó como "${res.financialStatus ?? 'sin cambios'}": revisá si hay que devolver el dinero a mano.`
          : 'Reembolso hecho en Shopify.',
      }
    }
    default:
      return { ok: false, message: `No sé cómo ejecutar "${fila.kind}".` }
  }
}
