/**
 * Crear un pedido en la tienda y dejarlo reflejado en Riverz.
 *
 * `createShopifyOrder` sólo habla con Shopify: a propósito no toca la base. Lo
 * que faltaba era el paso siguiente —la fila en `orders` y la atribución de la
 * venta— que estaba escrito adentro de la tool del agente que atiende clientes.
 * Mientras hubo un solo llamador eso no molestaba; con dos (el bot y el chat
 * agéntico que opera la cuenta) la segunda copia habría creado pedidos que no
 * aparecen en ninguna métrica ni en la ficha del contacto, porque el pedido
 * vive en Shopify y el espejo es lo que Riverz sabe mirar.
 */
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { recordOrderAttribution } from '@/lib/instagram-agent/order-attribution'
import {
  createShopifyOrder,
  type CreateOrderContext,
  type CreateOrderError,
  type CreateOrderInput,
  type CreateOrderResult,
} from '@/lib/shopify/create-order'
import type { CommercePlatform } from '@/lib/commerce/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Dónde queda anotado el pedido del lado de Riverz. */
export interface EspejoDePedido {
  /** Sin cuenta no hay espejo: el pedido se crea igual y no se anota. */
  workspaceId?: string | null
  /**
   * En qué tienda quedó el pedido. Se escribe siempre: la columna tiene
   * DEFAULT 'shopify' (migración 126), así que omitirla no deja el dato en
   * blanco —lo deja MAL, y un pedido de otra plataforma queda para siempre
   * contado como de Shopify.
   */
  platform?: CommercePlatform
  contactId?: string | null
  agentId?: string | null
  conversationId?: string | null
  channel?: string | null
  /** Los únicos valores que acepta `orders.created_by` (migración 137). */
  createdBy: 'ai' | 'manual'
  /** Cliente con el que escribir. Por defecto el de servicio. */
  db?: SupabaseClient
}

export async function crearPedidoConEspejo(
  input: CreateOrderInput,
  shop: CreateOrderContext,
  espejo: EspejoDePedido,
): Promise<CreateOrderResult | CreateOrderError> {
  const result = await createShopifyOrder(input, shop)
  if ('error' in result) return result

  if (espejo.workspaceId) {
    const db = espejo.db ?? supabaseAdmin()
    // Fail-soft: el pedido YA existe en Shopify. Si la fila no entra, lo peor
    // que pasa es que Riverz no lo muestre; decir que falló sería mentir sobre
    // un pedido que la clienta va a recibir igual.
    try {
      await db.from('orders').insert({
        workspace_id: espejo.workspaceId,
        platform: espejo.platform ?? 'shopify',
        contact_id: espejo.contactId ?? null,
        agent_id: espejo.agentId ?? null,
        conversation_id: espejo.conversationId ?? null,
        channel: espejo.channel ?? null,
        shop_domain: shop.shopDomain,
        shopify_order_id: result.shopify_order_id,
        order_number: result.order_number,
        order_status_url: result.order_status_url,
        currency: result.currency,
        total_price: result.total_price,
        line_items: result.line_items,
        customer_name: result.customer_name,
        customer_phone: result.customer_phone,
        customer_email: result.customer_email,
        shipping_address: result.shipping_address,
        payment_method: result.payment_method,
        financial_status: 'pending',
        status: 'created',
        created_by: espejo.createdBy,
        note: input.note ?? null,
      })
    } catch (err) {
      console.error('[pedidos] creado en Shopify pero el espejo en Riverz falló:', err)
    }

    // El motor de Instagram lleva su propio libro de ventas atribuidas.
    if (espejo.channel === 'instagram' || espejo.channel === 'ig_comment') {
      await recordOrderAttribution(espejo.db ?? supabaseAdmin(), {
        workspaceId: espejo.workspaceId,
        shopifyOrderId: result.shopify_order_id,
        orderName: result.order_number,
        source: 'agent',
        contactId: espejo.contactId ?? null,
        channel: espejo.channel,
        revenue: result.total_price,
        currency: result.currency,
      })
    }
  }

  return result
}
