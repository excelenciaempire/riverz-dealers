import { filtroDeNumero } from '@/lib/orders/numero'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Abrir una devolución o un cambio desde una conversación.
 *
 * Era el último hueco de postventa. Cancelar y reembolsar ya existían, pero
 * "me llegó roto, quiero devolverlo" no tenía dónde vivir: la política de
 * devolución era un texto suelto en una plantilla de flujo, así que cada caso
 * se resolvía de memoria, sin rastro y sin forma de saber cuántos hubo.
 *
 * Esto NO devuelve dinero ni cancela nada. Deja anotado el caso con el pedido,
 * el motivo y las fotos, y el comercio decide. Es a propósito: quien escribe
 * es un desconocido, y lo más caro que puede conseguir un mensaje bien armado
 * es que alguien tenga que leer una devolución de más.
 */

export interface DevolucionCtx {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  conversationId?: string | null
  agentId?: string | null
}

interface PedidoFila {
  id: string
  order_number: string | null
  status: string | null
}

export interface AbrirDevolucionInput {
  order_number?: string
  kind?: string
  reason?: string
  customer_note?: string
}

/**
 * Las fotos que la persona ya mandó en esta conversación.
 *
 * No se le piden al modelo: se leen del hilo. Un modelo que tiene que citar
 * URLs de adjuntos las inventa, y una devolución sin la foto correcta es una
 * devolución que alguien va a tener que reabrir.
 */
async function fotosDelHilo(ctx: DevolucionCtx): Promise<string[]> {
  if (!ctx.conversationId) return []
  const { data } = await ctx.db
    .from('messages')
    .select('media_url, media_mime, sender_type, created_at')
    .eq('conversation_id', ctx.conversationId)
    .eq('sender_type', 'customer')
    .not('media_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(6)
  const filas = (data ?? []) as Array<{ media_url: string | null; media_mime: string | null }>
  return filas
    .filter((f) => f.media_url && (f.media_mime ?? '').startsWith('image/'))
    .map((f) => f.media_url as string)
}

/** El pedido del que habla, con las mismas reglas que cancelar y reembolsar. */
async function resolverPedido(
  ctx: DevolucionCtx,
  orderNumber?: string,
): Promise<{ pedido: PedidoFila | null } | { error: string; message: string }> {
  const num = (orderNumber ?? '').trim().replace(/^#/, '')
  let q = ctx.db
    .from('orders')
    .select('id, order_number, status')
    .eq('workspace_id', ctx.workspaceId)
    .eq('contact_id', ctx.contactId)
    .not('status', 'in', '("cancelled","failed")')
    .order('created_at', { ascending: false })
    .limit(5)
  const filtro = filtroDeNumero(num)
  if (filtro) q = q.or(filtro)

  const { data } = await q
  const filas = (data ?? []) as PedidoFila[]

  if (filas.length === 0) {
    // Sin pedido en Riverz igual se abre: la compra pudo entrar por un canal
    // que todavía no espeja pedidos, y negarle la devolución a quien sí compró
    // es peor que anotar una con el número escrito a mano.
    return { pedido: null }
  }
  if (!num && filas.length > 1) {
    const lista = filas.map((f) => `#${f.order_number ?? '?'}`).join(', ')
    return {
      error: 'varios_pedidos',
      message: `Tiene más de un pedido (${lista}). Pregúntale por cuál es antes de abrirla.`,
    }
  }
  return { pedido: filas[0] }
}

export async function abrirDevolucion(
  ctx: DevolucionCtx,
  input: AbrirDevolucionInput,
): Promise<string> {
  const r = await resolverPedido(ctx, input.order_number)
  if ('error' in r) return JSON.stringify({ ok: false, ...r })

  const numero = (input.order_number ?? '').trim().replace(/^#/, '')
  if (!r.pedido && !numero) {
    return JSON.stringify({
      ok: false,
      error: 'sin_pedido',
      message: 'Necesito el número de pedido para abrir la devolución. Pídeselo.',
    })
  }

  const kind = input.kind === 'cambio' ? 'cambio' : 'devolucion'
  const fotos = await fotosDelHilo(ctx)

  const { data, error } = await ctx.db
    .from('returns')
    .insert({
      workspace_id: ctx.workspaceId,
      order_id: r.pedido?.id ?? null,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId ?? null,
      order_number: r.pedido?.order_number ?? (numero || null),
      kind,
      reason: (input.reason ?? '').trim().slice(0, 300) || null,
      customer_note: (input.customer_note ?? '').trim().slice(0, 1000) || null,
      photos: fotos,
      agent_id: ctx.agentId ?? null,
      created_by: 'ai',
    })
    .select('id, order_number')
    .single()

  if (error) {
    // El índice único: ya hay una abierta para ese pedido. Insistir en el chat
    // no puede abrir tres, y decirle "no se pudo" a quien ya la tiene abierta
    // la manda a escribir de nuevo.
    if (error.code === '23505') {
      return JSON.stringify({
        ok: true,
        estado: 'ya_abierta',
        message:
          'Ya hay una devolución abierta para ese pedido. Díselo así, sin abrir otra ni prometer nada nuevo.',
      })
    }
    return JSON.stringify({
      ok: false,
      message: 'No pude registrar la devolución. Dile que lo pasas al equipo.',
    })
  }

  const fila = data as { id: string; order_number: string | null }

  // Y se avisa. Sin esto el caso quedaba esperando a que alguien entrara a la
  // pantalla de devoluciones — el mismo defecto que las aprobaciones tenían: el
  // dato entra, nadie se entera, y la clienta espera una respuesta que nadie
  // sabe que le debe. No se espera el envío: la devolución ya está registrada y
  // que el WhatsApp tarde no puede trabar la conversación.
  void avisarDeLaDevolucion(ctx, {
    kind,
    orderNumber: fila.order_number ?? numero,
    motivo: (input.reason ?? '').trim(),
    fotos: fotos.length,
  }).catch(() => {})

  return JSON.stringify({
    ok: true,
    estado: 'abierta',
    return_id: fila.id,
    fotos: fotos.length,
    message:
      `Quedó registrada la ${kind === 'cambio' ? 'solicitud de cambio' : 'devolución'} del pedido ` +
      `#${fila.order_number ?? numero}. ` +
      (fotos.length > 0
        ? 'Las fotos que mandó ya quedaron adjuntas. '
        : 'Si todavía no mandó fotos del producto, pediselas: aceleran la revisión. ') +
      'Dile que el equipo la revisa y le confirma. ' +
      'NO le digas que está aprobada ni le prometas un reembolso ni una fecha.',
  })
}

/** El aviso por WhatsApp al comercio, por el mismo canal que las aprobaciones. */
async function avisarDeLaDevolucion(
  ctx: DevolucionCtx,
  d: { kind: string; orderNumber: string | null; motivo: string; fotos: number },
): Promise<void> {
  const { quienDecide } = await import('@/lib/approvals/ask')
  const { sendPlatformAlert } = await import('@/lib/admin/platform-whatsapp')

  const destino = await quienDecide(ctx.db, ctx.workspaceId)
  if (!destino) return

  const que = d.kind === 'cambio' ? 'un cambio' : 'una devolución'
  await sendPlatformAlert({
    to: destino,
    title: `Pidieron ${que}${d.orderNumber ? ` del pedido #${d.orderNumber}` : ''}`,
    body:
      `${d.motivo || 'Sin motivo escrito'}. ` +
      `${d.fotos > 0 ? `Mandó ${d.fotos} foto(s). ` : 'Sin fotos. '}` +
      `Miralo en Devoluciones.`,
  })
}
