import type { SupabaseClient } from '@supabase/supabase-js'
import { askForApproval } from '@/lib/approvals/ask'
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags'
import { markOrderPaid } from '@/lib/shopify/mark-paid'

/**
 * "Ya te transferí" — qué hacer con eso.
 *
 * Son dos decisiones, no una, y confundirlas es lo que hace que este problema
 * se resuelva mal en todos lados:
 *
 *   DEJAR DE INSISTIR es automático. Alcanza con que la persona lo diga. El
 *   daño de seguir mandándole recordatorios a quien ya pagó es inmediato y
 *   equivocarse callando no le cuesta nada a nadie: si no pagó, el pedido
 *   sigue pendiente y el comercio lo ve igual.
 *
 *   DAR POR COBRADO no. Marcar pagado un pedido que no se pagó termina en
 *   mercadería despachada de arriba. Se marca solo cuando el monto del
 *   comprobante coincide con lo que falta cobrar; si no coincide, o si no se
 *   pudo leer, se le pregunta a una persona.
 *
 * Lo primero pasa siempre. Lo segundo, sólo con certeza.
 */

/** Cuánto puede diferir el comprobante del pedido y aun así darse por bueno. */
const TOLERANCIA = 0.01

/**
 * ¿El comprobante alcanza para cobrar solo?
 *
 * Se exporta porque quien pregunta ANTES de ejecutar —la pantalla de
 * confirmación del chat agéntico— tiene que anticipar cuál de las dos ramas va
 * a pasar. Con la cuenta escrita dos veces, el aviso podría prometer "se marca
 * pagado" y terminar preguntándole a una persona.
 */
export function montoCoincide(
  totalDelPedido: string | number | null | undefined,
  montoDeclarado: number | null | undefined,
): boolean {
  const esperado = Number(totalDelPedido ?? '')
  const declarado = Number(montoDeclarado ?? NaN)
  return (
    Number.isFinite(esperado) &&
    Number.isFinite(declarado) &&
    Math.abs(esperado - declarado) <= Math.max(TOLERANCIA, esperado * 0.001)
  )
}

export type ReportOutcome =
  | { kind: 'cobrado'; amount: string }
  | { kind: 'a_confirmar'; reason: string; approvalId?: string }
  | { kind: 'sin_pedido' }
  | { kind: 'error'; error: string }

export interface ReportedPaymentInput {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  /** Monto leído del comprobante. Sin esto nunca se marca solo. */
  amount?: number | null
  /** Fila de `messages` donde llegó, para poder volver a mirarlo. */
  messageId?: string | null
}

/**
 * Anota que esta persona dijo que pagó y, si se puede, lo cobra.
 *
 * Devuelve qué pasó para que el agente se lo pueda contar al cliente sin
 * inventar: "ya lo tomamos" es distinto de "lo estamos verificando".
 */
export async function registerReportedPayment(
  input: ReportedPaymentInput,
): Promise<ReportOutcome> {
  const { db, workspaceId, contactId } = input

  // El pedido pendiente más reciente de esta persona. Si tiene dos, gana el
  // último: es de lo que están hablando.
  const { data, error } = await db
    .from('orders')
    .select('id, shopify_order_id, order_number, total_price, currency, financial_status')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .neq('financial_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { kind: 'error', error: error.message }
  const order = data as {
    id: string
    shopify_order_id: string | null
    order_number: string | null
    total_price: string | null
    currency: string | null
    financial_status: string | null
  } | null
  if (!order) return { kind: 'sin_pedido' }

  // Paso 1, siempre: dejar de insistir. Se anota antes de intentar cobrar,
  // porque si Shopify falla la persona igual dejó de deber la conversación.
  await db
    .from('orders')
    .update({
      payment_reported_at: new Date().toISOString(),
      payment_reported_amount: input.amount ?? null,
      payment_report_message_id: input.messageId ?? null,
    })
    .eq('id', order.id)

  // Paso 2: ¿alcanza para cobrar solo?
  const esperado = Number(order.total_price ?? '')
  const declarado = Number(input.amount ?? NaN)

  if (!montoCoincide(order.total_price, input.amount)) {
    const motivo = !Number.isFinite(declarado)
      ? 'no se pudo leer el monto del comprobante'
      : `el comprobante dice ${declarado} y el pedido es de ${esperado}`
    return { kind: 'a_confirmar', reason: motivo }
  }

  if (!order.shopify_order_id) {
    return { kind: 'a_confirmar', reason: 'el pedido no está en Shopify' }
  }

  const admin = await resolveShopifyAdmin(db, workspaceId)
  if (!admin) return { kind: 'a_confirmar', reason: 'la tienda no está conectada' }

  const res = await markOrderPaid(admin, order.shopify_order_id)
  if (!res.ok) {
    return { kind: 'a_confirmar', reason: res.error ?? 'Shopify no aceptó el cobro' }
  }

  await db
    .from('orders')
    .update({
      financial_status: res.financialStatus ?? 'paid',
      payment_report_outcome: 'automatico',
    })
    .eq('id', order.id)

  return { kind: 'cobrado', amount: res.amount ?? String(esperado) }
}

/** Datos del pedido pendiente, para armar el aviso que va al comercio. */
export interface PedidoPendiente {
  id: string
  orderNumber: string | null
  total: string | null
  currency: string | null
  shopifyOrderId: string | null
}

export async function pendingOrderFor(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<PedidoPendiente | null> {
  const { data } = await db
    .from('orders')
    .select('id, order_number, total_price, currency, shopify_order_id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .neq('financial_status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as {
    id: string
    order_number: string | null
    total_price: string | null
    currency: string | null
    shopify_order_id: string | null
  } | null
  if (!row) return null
  return {
    id: row.id,
    orderNumber: row.order_number,
    total: row.total_price,
    currency: row.currency,
    shopifyOrderId: row.shopify_order_id,
  }
}

export interface PagoInformado {
  resultado: ReportOutcome
  /** El pedido sobre el que quedó la duda. Sólo cuando hay que preguntar. */
  pedido: PedidoPendiente | null
  approvalId?: string
}

/**
 * Lo mismo que `registerReportedPayment`, más el paso que le faltaba: cuando no
 * alcanza para cobrar solo, preguntarle a una persona del negocio.
 *
 * Las dos mitades estaban separadas — registrar acá, preguntar en la tool del
 * agente— y eso dejaba la mitad peligrosa afuera de la librería: cualquier
 * segundo llamador que registrara un pago sin acordarse de pedir la aprobación
 * dejaría el comprobante dudoso esperando a nadie, con los recordatorios ya
 * apagados. Quien informa un pago llama esto y no la mitad de abajo.
 */
export async function informarPago(
  input: ReportedPaymentInput & { note?: string | null },
): Promise<PagoInformado> {
  const resultado = await registerReportedPayment(input)
  if (resultado.kind !== 'a_confirmar') return { resultado, pedido: null }

  const pedido = await pendingOrderFor(input.db, input.workspaceId, input.contactId)
  const aviso = await askForApproval({
    db: input.db,
    workspaceId: input.workspaceId,
    kind: 'pago_informado',
    title: `Pago informado — pedido ${pedido?.orderNumber ?? 's/n'}`,
    body:
      `Un cliente dice que ya pagó ${pedido?.total ?? ''} ${pedido?.currency ?? ''}. ` +
      `${input.note ?? ''} (${resultado.reason}). ¿Lo marco como pagado en Shopify?`,
    payload: {
      order_id: pedido?.id,
      shopify_order_id: pedido?.shopifyOrderId,
      contact_id: input.contactId,
    },
  })

  return { resultado, pedido, approvalId: aviso.approvalId }
}
