import { filtroDeNumero, conAlmohadilla } from '@/lib/orders/numero'
import type { SupabaseClient } from '@supabase/supabase-js'
import { askForApproval, APROBACION_PENDIENTE } from '@/lib/approvals/ask'

/**
 * Cancelar y reembolsar, desde una conversación.
 *
 * Las dos mueven dinero y no se deshacen, así que el agente **propone y una
 * persona decide**. No es prudencia de más: quien escribe en el chat es un
 * desconocido, y el día que un modelo se deje convencer por un mensaje bien
 * armado, lo peor que puede conseguir es que al comercio le llegue una
 * pregunta por WhatsApp.
 *
 * Lo que sí cambia respecto de antes es quién hace el trabajo. Hasta acá el
 * agente sólo sabía escalar: la conversación quedaba marcada y alguien tenía
 * que leer el hilo entero, buscar el pedido y entender qué pasó. Ahora llega
 * armada — pedido, monto, motivo — y decidir es un sí o un no.
 */

export interface PostventaCtx {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  /** Para poder pasarle el hilo a una persona si el aviso no salió. */
  conversationId?: string | null
}

/**
 * Marca la conversación para que la mire alguien.
 *
 * Se usa cuando la solicitud quedó anotada pero el aviso al comercio no salió:
 * la clienta ya escuchó "te confirmo en breve" y nadie del otro lado se enteró,
 * así que el hilo no puede quedar esperando solo.
 *
 * A diferencia del escalamiento por palabra clave, acá el agente NO se apaga:
 * la persona sigue conversando y puede preguntar otra cosa. Lo que hace falta
 * es que el comercio vea el hilo, no que la clienta se quede sin nadie.
 */
async function pedirAyuda(ctx: PostventaCtx): Promise<void> {
  if (!ctx.conversationId) return
  // Las mismas columnas que usa el escalamiento del runner. No hay un booleano
  // `needs_human`: lo que marca el hilo es tener `needs_human_at` puesto.
  //
  // Y el motivo NO es texto libre: la migración 178 lo acotó a una lista, así
  // que una frase inventada acá hacía fallar el UPDATE entero y dejaba el hilo
  // sin marcar — el mismo silencio que esa migración vino a evitar.
  const { error } = await ctx.db
    .from('conversations')
    .update({
      status: 'pending',
      needs_human_reason: 'approval_unnotified',
      needs_human_at: new Date().toISOString(),
    })
    .eq('id', ctx.conversationId)
    .eq('workspace_id', ctx.workspaceId)
  if (error) console.error('[postventa] no se pudo pedir ayuda:', error.message)
}

interface PedidoDelCliente {
  id: string
  shopify_order_id: string | null
  order_number: string | null
  total_price: number | string | null
  currency: string | null
  status: string | null
  shop_domain: string | null
}

/**
 * El pedido del que habla la clienta.
 *
 * Con número, ése. Sin número, el último — pero sólo si tiene UNO: elegirle el
 * pedido a alguien que hizo tres es la forma de cancelar el equivocado.
 */
async function resolverPedido(
  ctx: PostventaCtx,
  orderNumber?: string,
): Promise<{ pedido: PedidoDelCliente } | { error: string; message: string }> {
  let q = ctx.db
    .from('orders')
    .select('id, shopify_order_id, order_number, total_price, currency, status, shop_domain')
    .eq('workspace_id', ctx.workspaceId)
    .eq('contact_id', ctx.contactId)
    .not('status', 'in', '("cancelled","failed")')
    .order('created_at', { ascending: false })
    .limit(5)

  // Con o sin almohadilla: Shopify guarda `#1001` y Tiendanube `111`. Sacarla
  // antes de comparar hacía que en Shopify no coincidiera nunca.
  const num = (orderNumber ?? '').trim().replace(/^#/, '')
  const filtro = filtroDeNumero(orderNumber ?? '')
  if (filtro) q = q.or(filtro)

  const { data } = await q
  const filas = (data ?? []) as PedidoDelCliente[]

  if (filas.length === 0) {
    return {
      error: 'sin_pedido',
      message: num
        ? `No encontré el pedido ${num} a nombre de esta persona. Pídele que verifique el número.`
        : 'No encontré ningún pedido activo de esta persona. Pídele el número de pedido.',
    }
  }
  if (!num && filas.length > 1) {
    const lista = filas.map((f) => conAlmohadilla(f.order_number) || '#?').join(', ')
    return {
      error: 'varios_pedidos',
      message: `Tiene más de un pedido activo (${lista}). Pregúntale cuál antes de seguir.`,
    }
  }
  return { pedido: filas[0] }
}

function plata(p: PedidoDelCliente): string {
  const n = totalDe(p)
  return n != null && n > 0 ? `${n} ${p.currency ?? ''}`.trim() : 'monto sin registrar'
}

function totalDe(p: PedidoDelCliente): number | null {
  const n = typeof p.total_price === 'number' ? p.total_price : Number(p.total_price ?? NaN)
  return Number.isFinite(n) ? n : null
}

/**
 * ¿Ya hay una solicitud esperando por este pedido?
 *
 * Sin esto, insistir generaba una segunda: al comercio le llegaban dos avisos
 * idénticos ("¿Reembolsar 5000 del pedido #1042?"), aprobaba los dos creyendo
 * que era el mismo repetido, y se devolvía el doble. El guard de la aprobación
 * evita ejecutar UNA dos veces, no dos distintas. Y el modelo puede pedir dos
 * en un mismo turno, así que no alcanza con confiar en él.
 */
async function yaPedido(
  ctx: PostventaCtx,
  kind: string,
  shopifyOrderId: string,
): Promise<boolean> {
  const { data } = await ctx.db
    .from('approval_requests')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('kind', kind)
    .eq('status', APROBACION_PENDIENTE)
    .contains('payload', { shopify_order_id: shopifyOrderId })
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

/** Deja pedida la cancelación y le dice al modelo qué contarle a la clienta. */
export async function proponerCancelacion(
  ctx: PostventaCtx,
  input: { order_number?: string; reason?: string },
): Promise<string> {
  const r = await resolverPedido(ctx, input.order_number)
  if ('error' in r) return JSON.stringify({ ok: false, ...r })
  const p = r.pedido

  if (!p.shopify_order_id) {
    return JSON.stringify({
      ok: false,
      // Pedidos de Mercado Libre o espejados a mano: existen en Riverz pero no
      // hay a qué API pedirle la cancelación.
      error: 'pedido_no_cancelable',
      message:
        'Ese pedido no se puede cancelar automáticamente. Dile que lo pasas al equipo y va a tener respuesta a la brevedad.',
    })
  }

  if (await yaPedido(ctx, 'cancelar_pedido', p.shopify_order_id)) {
    return JSON.stringify({
      ok: true,
      estado: 'pendiente_de_aprobacion',
      message:
        'Ya habías pedido la cancelación de ese pedido y sigue esperando la confirmación del equipo. Díselo así, sin volver a prometer nada nuevo.',
    })
  }

  const motivo = (input.reason ?? '').trim().slice(0, 300)
  const res = await askForApproval({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    kind: 'cancelar_pedido',
    title: `¿Cancelar el pedido ${conAlmohadilla(p.order_number ?? p.shopify_order_id)}?`,
    body:
      `Lo pidió la clienta por chat.\n` +
      `Importe: ${plata(p)}.\n` +
      (motivo ? `Motivo: ${motivo}\n` : '') +
      `Si aceptas, se cancela en la tienda, vuelve el stock y se devuelve lo cobrado.`,
    payload: {
      order_id: p.id,
      shopify_order_id: p.shopify_order_id,
      shop_domain: p.shop_domain,
      reason: motivo || 'customer',
    },
  })

  if (!res.ok) {
    return JSON.stringify({
      ok: false,
      message:
        'No pude dejar pedida la cancelación. Dile que lo pasas al equipo y que le confirman en breve.',
    })
  }

  // Si el aviso no salió, la fila igual quedó esperando en el panel — pero
  // nadie se enteró. Decirle a la clienta "te confirmo en breve" ahí es una
  // promesa que no depende de nadie, así que la conversación pasa a manos de
  // una persona en vez de quedar esperando sola.
  if (!res.notified) await pedirAyuda(ctx)

  return JSON.stringify({
    ok: true,
    estado: 'pendiente_de_aprobacion',
    message:
      `Quedó pedida la cancelación del pedido ${conAlmohadilla(p.order_number)}. ` +
      'Dile que ya lo pasaste y que le confirmas apenas esté. ' +
      'NO le digas que el pedido ya está cancelado ni que le devolvieron el dinero.',
  })
}

/** Lo mismo para un reembolso sin cancelar la compra. */
export async function proponerReembolso(
  ctx: PostventaCtx,
  input: { order_number?: string; amount?: number; reason?: string },
): Promise<string> {
  const r = await resolverPedido(ctx, input.order_number)
  if ('error' in r) return JSON.stringify({ ok: false, ...r })
  const p = r.pedido

  if (!p.shopify_order_id) {
    return JSON.stringify({
      ok: false,
      error: 'pedido_no_reembolsable',
      message:
        'Ese pedido no se puede reembolsar automáticamente. Dile que lo pasas al equipo.',
    })
  }

  if (await yaPedido(ctx, 'reembolsar_pedido', p.shopify_order_id)) {
    return JSON.stringify({
      ok: true,
      estado: 'pendiente_de_aprobacion',
      message:
        'Ya habías pedido un reembolso de ese pedido y sigue esperando la confirmación del equipo. Díselo así, sin volver a prometer nada nuevo.',
    })
  }

  const motivo = (input.reason ?? '').trim().slice(0, 300)
  const total = totalDe(p)
  const pedido = typeof input.amount === 'number' && input.amount > 0 ? input.amount : null
  // Nunca por encima de lo que costó el pedido. El monto lo propone el modelo,
  // y una coma de más en un mensaje convierte 5.000 en 500.000.
  if (pedido != null && total != null && pedido > total) {
    return JSON.stringify({
      ok: false,
      error: 'monto_mayor_al_pedido',
      message: `Ese pedido costó ${plata(p)}: no se puede devolver más que eso. Pide un importe menor o el total.`,
    })
  }
  const monto = pedido

  const res = await askForApproval({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    kind: 'reembolsar_pedido',
    title: `¿Reembolsar ${monto ? `${monto} del` : 'el'} pedido ${conAlmohadilla(p.order_number ?? p.shopify_order_id)}?`,
    body:
      `Lo pidió la clienta por chat.\n` +
      `Importe del pedido: ${plata(p)}.\n` +
      `A devolver: ${monto ?? 'todo lo cobrado'}.\n` +
      (motivo ? `Motivo: ${motivo}\n` : '') +
      `El pedido NO se cancela: sólo se devuelve el dinero.`,
    payload: {
      order_id: p.id,
      shopify_order_id: p.shopify_order_id,
      shop_domain: p.shop_domain,
      amount: monto,
      reason: motivo || null,
    },
  })

  if (!res.ok) {
    return JSON.stringify({
      ok: false,
      message: 'No pude dejar pedido el reembolso. Dile que lo pasas al equipo.',
    })
  }

  if (!res.notified) await pedirAyuda(ctx)

  return JSON.stringify({
    ok: true,
    estado: 'pendiente_de_aprobacion',
    message:
      'Quedó pedido el reembolso. Dile que ya lo pasaste y que le confirmas apenas esté. ' +
      'NO le digas que el dinero ya fue devuelto ni prometas una fecha.',
  })
}
