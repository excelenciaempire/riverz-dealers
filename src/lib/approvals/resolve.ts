import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { markOrderPaid } from '@/lib/shopify/mark-paid'
import { cancelOrder, refundOrder } from '@/lib/shopify/order-cancel'
import { cancelarPedidoEnLaTienda } from '@/lib/commerce/order-cancel'
import { APROBACION_PENDIENTE,quienDecide } from './ask'
import { localeDeCuenta } from '@/lib/i18n/cuenta'
import { translate } from '@/lib/i18n/translate'
import { canDecideHttpAction, executeApprovedHttpAction, httpApprovalPanelMessage, isHttpActionApproval } from './http-action'

const REFUND_ERRORS: Record<string, string> = {
  invalid_refund_amount: 'refundAmountInvalid', refund_pending: 'refundPending',
  refund_already_returned: 'refundAlreadyReturned', refund_history_unverified: 'refundHistoryUnverified',
  refund_result_unverified: 'refundResultUnverified',
  cancel_result_unverified: 'orderResultUnverified',
}

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
  uncertain?: boolean
  execution?: Record<string,unknown>
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
    .eq('status', APROBACION_PENDIENTE)
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
  if (fila.kind === 'herramienta' && isHttpActionApproval(fila.payload)) {
    return { ok: false, message: httpApprovalPanelMessage(await localeDeCuenta(db, fila.workspace_id)) };
  }

  if (['cancelar_pedido','reembolsar_pedido'].includes(fila.kind)) {
    const currentPhone = (await quienDecide(db,fila.workspace_id))?.replace(/\D/g,'').slice(-8)
    if (currentPhone !== ultimos8) return { ok:false,message:translate(await localeDeCuenta(db,fila.workspace_id),'approvals.orderExecutionUnavailable') }
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
  // Authorize financial decisions before changing the pending request, so an
  // unauthorized teammate cannot consume an approval that an admin still needs.
  let pendingQuery = db.from('approval_requests').select('kind,workspace_id,payload').eq('id',args.approvalId)
  if (args.workspaceId) pendingQuery = pendingQuery.eq('workspace_id',args.workspaceId)
  const pending = await pendingQuery.maybeSingle()
  if (pending.error) return { ok:false,message:translate(args.workspaceId ? await localeDeCuenta(db,args.workspaceId) : 'es','approvals.decisionUnavailable') }
  const httpDecision = pending.data?.kind === 'herramienta' && isHttpActionApproval(pending.data.payload);
  if (httpDecision && pending.data && (!args.workspaceId || !await canDecideHttpAction(db, pending.data.workspace_id, args.decidedBy, pending.data.payload, args.via))) {
    return { ok: false, message: httpApprovalPanelMessage(await localeDeCuenta(db, pending.data.workspace_id)) };
  }
  if (pending.data && ['cancelar_pedido','reembolsar_pedido'].includes(pending.data.kind) && args.via === 'panel') {
    const locale = await localeDeCuenta(db,pending.data.workspace_id)
    if (!args.decidedBy) return { ok:false,message:translate(locale,'approvals.orderExecutionUnavailable') }
    const member = await db.from('workspace_members').select('role').eq('workspace_id',pending.data.workspace_id).eq('user_id',args.decidedBy).maybeSingle()
    if (member.error || !member.data || !['admin','owner'].includes(member.data.role)) return { ok:false,message:translate(locale,'approvals.orderExecutionUnavailable') }
  }
  let q = db
    .from('approval_requests')
    .update({
      status: args.decision,
      decided_at: new Date().toISOString(),
      decided_via: args.via,
      decided_by: args.decidedBy ?? null,
    })
    .eq('id', args.approvalId)
    .eq('status', APROBACION_PENDIENTE)
    .gt('expires_at', new Date().toISOString())
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
    await cerrarDuplicadosDePago(db, fila, args)
    return { ok: true, message: 'Listo, no se hizo nada.', approvalId: fila.id }
  }

  let ejecucion: ResolveResult
  if (['cancelar_pedido','reembolsar_pedido'].includes(fila.kind)) {
    const locale = await localeDeCuenta(db,fila.workspace_id)
    const lock = await db.rpc('claim_approved_order_execution',{ p_workspace_id:fila.workspace_id,p_order_id:String(fila.payload.order_id ?? ''),p_approval_id:fila.id })
    if (lock.error || lock.data !== true) {
      ejecucion = { ok:false,message:translate(locale,lock.error ? 'approvals.orderExecutionUnavailable' : 'approvals.orderExecutionBusy') }
    } else {
      try { ejecucion = await ejecutar(db,fila) }
      catch { ejecucion = { ok:false,uncertain:true,message:translate(locale,'approvals.refundResultUnverified') } }
      const finished = await db.rpc('finish_approved_order_execution',{ p_workspace_id:fila.workspace_id,p_approval_id:fila.id,p_uncertain:ejecucion.uncertain === true })
      if (finished.error) ejecucion = { ok:false,uncertain:true,message:translate(locale,'approvals.refundResultUnverified') }
    }
  } else if (httpDecision) ejecucion = await executeApprovedHttpAction(db,
    { workspaceId: fila.workspace_id, approvalId: fila.id, actorId: args.decidedBy! }, fila.payload, await localeDeCuenta(db, fila.workspace_id))
  else ejecucion = await ejecutar(db, fila)
  const resultQuery = db
    .from('approval_requests')
    .update({
      result: ejecucion.message,
      execution_result: ejecucion.execution ?? null,
      status: ejecucion.ok ? 'aprobada' : 'fallida',
    })
    .eq('id', fila.id)
  if (httpDecision) {
    let saved;
    try { saved = await resultQuery.eq('workspace_id', fila.workspace_id).select('id,status,result,execution_result').maybeSingle(); }
    catch { return { ok: false, uncertain: true, message: httpApprovalPanelMessage(await localeDeCuenta(db, fila.workspace_id)), approvalId: fila.id }; }
    const expected = ejecucion.execution ?? null, actual = saved.data?.execution_result;
    const sameResult = expected === null ? actual === null : actual && typeof actual === 'object' && !Array.isArray(actual)
      && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => actual[key] === value);
    if (saved.error || saved.data?.id !== fila.id || saved.data.status !== (ejecucion.ok ? 'aprobada' : 'fallida')
      || saved.data.result !== ejecucion.message || !sameResult) {
      return { ok: false, uncertain: true, message: httpApprovalPanelMessage(await localeDeCuenta(db, fila.workspace_id)), approvalId: fila.id };
    }
  } else await resultQuery
  if (ejecucion.ok) await cerrarDuplicadosDePago(db, fila, args)
  return { ...ejecucion, approvalId: fila.id }
}

/**
 * Cierra los avisos viejos del mismo pago una vez que uno se decidió.
 *
 * Antes de que existiera `dedupe_key` podían quedar varias filas: texto,
 * audio y comprobante pedían aprobar el mismo pedido por separado. No son
 * rechazos de pago; quedan con el resultado explícito para que el historial
 * explique por qué no se volvieron a mostrar ni ejecutar.
 */
async function cerrarDuplicadosDePago(
  db: SupabaseClient,
  fila: { workspace_id: string; kind: string; payload: Record<string, unknown> },
  args: { decision: Decision; via: 'whatsapp' | 'panel'; decidedBy?: string | null },
): Promise<void> {
  if (fila.kind !== 'pago_informado') return
  const orderId = String(fila.payload.order_id ?? '')
  if (!orderId) return

  await db
    .from('approval_requests')
    .update({
      status: 'rechazada',
      decided_at: new Date().toISOString(),
      decided_via: args.via,
      decided_by: args.decidedBy ?? null,
      result:
        args.decision === 'aprobada'
          ? 'Duplicada: otra solicitud de este pago ya fue aprobada.'
          : 'Duplicada: otra solicitud de este pago ya fue rechazada.',
    })
    .eq('workspace_id', fila.workspace_id)
    .eq('kind', 'pago_informado')
    .eq('status', APROBACION_PENDIENTE)
    .contains('payload', { order_id: orderId })
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
    // Cualquier herramienta que el comercio puso "con aprobación": el agente
    // la preparó, alguien dijo que sí, y acá se ejecuta con el mismo argumento
    // que esa persona leyó.
    case 'herramienta': {
      const { leerHerramienta, ejecutarHerramienta } = await import('./ejecutar-herramienta')
      const h = leerHerramienta(fila.payload)
      if (!h) return { ok: false, message: 'Esa solicitud no dice qué hacer.' }
      return ejecutarHerramienta(db, fila.workspace_id, h)
    }
    case 'cancelar_pedido':
    case 'reembolsar_pedido': {
      const shopifyOrderId = String(fila.payload.shopify_order_id ?? '')
      const orderId = String(fila.payload.order_id ?? '')
      if (!shopifyOrderId) {
        return { ok: false, message: 'El pedido no está en Shopify: resuélvelo a mano.' }
      }
      const cancelando = fila.kind === 'cancelar_pedido'
      const admin = await resolveShopifyAdmin(db, fila.workspace_id)

      // Sin Shopify la tienda puede ser Tiendanube o WooCommerce, y ahí
      // cancelar también se puede. Antes esto cortaba con "la tienda no está
      // conectada" DESPUÉS de que el agente le prometiera la cancelación a la
      // clienta y el comercio dijera que sí: lo peor de los dos mundos.
      //
      // Reembolsar no: en esas plataformas el cobro suele estar afuera (un link
      // de pago, una transferencia) y no hay a quién pedirle la devolución.
      if (!admin) {
        if (!cancelando) {
          return {
            ok: false,
            message: 'El cobro de ese pedido no se hizo por la tienda: devuelve el dinero por donde entró.',
          }
        }
        const local = await cancelarPedidoEnLaTienda(db, {
          workspaceId: fila.workspace_id,
          externalOrderId: shopifyOrderId,
          reason: (fila.payload.reason as string | null) ?? null,
        })
        if (!local.ok) return { ok: false, message: local.message }
        if (orderId) {
          await db
            .from('orders')
            .update({ status: 'cancelled', financial_status: 'voided' })
            .eq('id', orderId)
            .eq('workspace_id', fila.workspace_id)
        }
        return { ok: true, message: 'El pedido quedó cancelado en la tienda.' }
      }

      if (typeof fila.payload.shop_domain === 'string' && fila.payload.shop_domain.toLowerCase() !== admin.shopDomain.toLowerCase()) {
        return { ok:false,message:translate(await localeDeCuenta(db,fila.workspace_id),'approvals.orderStoreChanged') }
      }
      if (!cancelando && fila.payload.amount != null && typeof fila.payload.amount !== 'number') {
        return { ok: false, message: translate(await localeDeCuenta(db, fila.workspace_id), 'approvals.refundAmountInvalid') }
      }
      let res = cancelando
        ? await cancelOrder(admin, shopifyOrderId, {
            reason: String(fila.payload.reason ?? 'customer'),
          })
        : await refundOrder(admin, shopifyOrderId, {
            amount:
              typeof fila.payload.amount === 'number' ? fila.payload.amount : undefined,
            reason: (fila.payload.reason as string | null) ?? undefined,
          })

      if (!res.ok) {
        const execution = { order_id:orderId,shopify_order_id:shopifyOrderId,refund_id:res.refundId ?? null,financial_status:res.financialStatus ?? null }
        const refundErrorKey = REFUND_ERRORS[res.error ?? '']
        if (refundErrorKey) return { ok: false, execution, uncertain:res.uncertain || res.error === 'refund_result_unverified', message: translate(await localeDeCuenta(db, fila.workspace_id), `approvals.${refundErrorKey}`) }
        // El caso con arreglo se nombra: la tienda se conectó antes de que el
        // set de permisos incluyera escritura y hay que reconectarla.
        if (res.error === 'missing_write_scope') {
          return {
            ok: false,
            message: 'Falta permiso de escritura en Shopify. Reconecta la tienda y vuelve a intentar.',
          }
        }
        if (res.error === 'sin_cobro_registrado') {
          return {
            ok: false,
            message: 'Ese pedido no tiene un cobro registrado en Shopify: devuelve el dinero por donde entró.',
          }
        }
        if (res.error === 'monto_mayor_al_cobrado') {
          return {
            ok: false,
            message: 'El importe pedido supera lo que se cobró de ese pedido. No se devolvió nada.',
          }
        }
        return { ok: false, execution, uncertain:res.uncertain, message: res.error ?? 'Shopify no aceptó la operación.' }
      }

      // Cancelar tiene que devolver el dinero, y no se confía en que lo haya
      // hecho: `cancel.json` recibe `refund` como bandera y la versión actual
      // de la API la documenta como un objeto de transacciones, así que puede
      // estar ignorándola. En vez de adivinar, se mira lo que Shopify informó:
      // si el pago NO quedó devuelto, se devuelve explícitamente. Condicionarlo
      // al estado observado es lo que impide devolver dos veces si la bandera
      // sí funcionaba.
      //
      // Cancelar sin reembolsar deja al cliente sin producto y sin plata, que
      // es el peor resultado posible de los dos.
      if (cancelando && res.ok && res.financialStatus && res.financialStatus !== 'refunded') {
        if (res.financialStatus === 'paid' || res.financialStatus === 'partially_refunded') {
          const vuelto = await refundOrder(admin, shopifyOrderId, { reason: 'cancelación' })
          if (vuelto.ok) res = vuelto
          else {
            res.uncertain = vuelto.uncertain || vuelto.error === 'refund_result_unverified'
            res.refundId = vuelto.refundId
            console.warn(
              `[aprobaciones] pedido ${shopifyOrderId} cancelado pero el reembolso falló:`,
              vuelto.error,
            )
          }
        }
      }

      // El espejo se actualiza igual: el webhook de Shopify también va a
      // llegar, pero puede tardar, y hasta entonces el pedido seguiría
      // figurando activo en Riverz — justo mientras alguien mira si funcionó.
      if (orderId) {
        await db
          .from('orders')
          .update(
            cancelando
              ? {
                  status: 'cancelled',
                  // Sin dato de Shopify no se inventa "refunded": un pedido
                  // contra reembolso que se cancela queda anotado como
                  // devuelto aunque nunca haya entrado un peso, y ese es el
                  // número que después se cuadra contra la caja.
                  financial_status: res.financialStatus ?? 'voided',
                }
              : { financial_status: res.financialStatus },
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
        ...(res.uncertain ? { uncertain:true } : {}),
        execution:{ order_id:orderId,shopify_order_id:shopifyOrderId,cancelled:cancelando,refund_id:res.refundId ?? null,
          refunded_amount:res.refundedAmount ?? null,currency:res.currency ?? null,financial_status:res.financialStatus ?? null },
        message: cancelando
          ? devuelto
            ? 'Pedido cancelado y dinero devuelto en Shopify.'
            : `Pedido cancelado en Shopify. El pago quedó como "${res.financialStatus ?? 'sin cambios'}": revisa si hay que devolver el dinero a mano.`
          : 'Reembolso hecho en Shopify.',
      }
    }
    default:
      return { ok: false, message: `No sé cómo ejecutar "${fila.kind}".` }
  }
}
