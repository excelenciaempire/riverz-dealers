/**
 * Pedidos de la cuenta.
 *
 * Lee la tabla espejo local, que es lo que se sincroniza desde Shopify,
 * Tiendanube, WooCommerce y Mercado Libre. No consulta al proveedor: para "¿el
 * pedido 1234 está pago?" en tiempo real está la herramienta del agente
 * (`lookup_order`), que sí va a la tienda.
 */
import { since, windowDays } from './predicates'
import type { Capability, CapabilityContext } from './types'

async function listar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const d = windowDays(args.dias, 30)
  let q = ctx.db
    .from('orders')
    .select(
      'order_number, customer_name, customer_phone, total_price, currency, financial_status, fulfillment_status, shipping_status, tracking_number, tracking_url, channel, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .gte('created_at', since(d))
    .order('created_at', { ascending: false })
    .limit(100)
  if (args.estado_pago) q = q.eq('financial_status', String(args.estado_pago))

  const { data } = await q
  return { periodo_dias: d, pedidos: data ?? [] }
}

export const ORDER_CAPABILITIES: Capability[] = [
  {
    key: 'pedidos.listar',
    description:
      'Los pedidos de la cuenta con su estado de pago y de envío, incluido el seguimiento cuando existe. Sirve para contestarle a un cliente dónde está lo suyo.',
    descriptionEn:
      'The orders of the account with their payment and shipping status, including tracking when it exists. Useful for telling a customer where their package is.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 30, máximo 90.' },
        estado_pago: {
          type: 'string',
          description: 'Filtrar por estado de pago, p. ej. "pending" o "paid".',
        },
      },
    },
    run: listar,
  },
]
