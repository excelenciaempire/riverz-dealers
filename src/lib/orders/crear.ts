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
import { contarLaVenta } from '@/lib/orders/contar-conversion'
import {
  createShopifyOrder,
  type CreateOrderContext,
  type CreateOrderError,
  type CreateOrderInput,
  type CreateOrderResult,
} from '@/lib/shopify/create-order'
import {
  crearPedidoEnLaTienda,
  type DatosDelCliente,
  type LineaDePedido,
  type PedidoCreado,
  type PedidoError,
} from '@/lib/commerce/create-order'
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

    // Un pedido creado por el agente no pasa por el checkout, así que el píxel
    // del navegador no dispara: si no se cuenta acá, no se cuenta en ningún
    // lado. Con el id de Shopify, que es el mismo que usaría el píxel — así
    // Meta descarta el duplicado si además hubo checkout.
    void contarLaVenta(db, {
      workspaceId: espejo.workspaceId,
      orderId: result.shopify_order_id,
      conversationId: espejo.conversationId ?? null,
      total: result.total_price,
      currency: result.currency,
      cliente: {
        email: result.customer_email,
        phone: result.customer_phone,
        nombre: result.customer_name,
        ciudad: (result.shipping_address as { city?: string } | null)?.city ?? null,
        provincia: (result.shipping_address as { province?: string } | null)?.province ?? null,
        pais: (result.shipping_address as { country?: string } | null)?.country ?? null,
      },
    })

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

/**
 * Lo mismo, para una tienda que no es Shopify.
 *
 * `crearPedidoEnLaTienda` creaba el pedido en Tiendanube o WooCommerce y ahí
 * terminaba: no había fila en `orders`. La venta existía en la tienda y para
 * Riverz no había pasado nada — sin atribución a la conversación, sin aparecer
 * en las Compras del contacto, sin contar en las métricas. Justo lo que el
 * comentario de arriba dice que no puede volver a pasar.
 *
 * `shop_domain` guarda el dominio de la tienda y `shopify_order_id` el id de la
 * plataforma que sea: son las columnas que ya existen y las que después usa
 * `lookup_order` para encontrar el pedido de esta persona.
 */
export async function crearPedidoLocalConEspejo(
  db: SupabaseClient,
  args: {
    workspaceId: string
    lineas: LineaDePedido[]
    cliente: DatosDelCliente
    nota?: string | null
  },
  espejo: Omit<EspejoDePedido, 'workspaceId' | 'platform' | 'db'>,
): Promise<PedidoCreado | PedidoError> {
  const res = await crearPedidoEnLaTienda(db, args)
  if ('error' in res) return res

  // Fail-soft por la misma razón: el pedido ya está hecho en la tienda.
  try {
    await db.from('orders').insert({
      workspace_id: args.workspaceId,
      platform: res.platform,
      contact_id: espejo.contactId ?? null,
      agent_id: espejo.agentId ?? null,
      conversation_id: espejo.conversationId ?? null,
      channel: espejo.channel ?? null,
      shopify_order_id: res.external_id,
      order_number: res.order_number,
      order_status_url: res.pay_url,
      currency: res.currency,
      total_price: res.total,
      line_items: args.lineas,
      customer_name: args.cliente.name ?? null,
      customer_phone: args.cliente.phone ?? null,
      customer_email: args.cliente.email ?? null,
      shipping_address: args.cliente.address ?? null,
      financial_status: 'pending',
      status: 'created',
      created_by: espejo.createdBy,
      note: args.nota ?? null,
    })
  } catch (err) {
    console.error('[pedidos] creado en la tienda pero el espejo en Riverz falló:', err)
  }

  // Y que Meta se entere. Sin esto, una venta de contra-entrega cerrada en el
  // chat no existe para el algoritmo: no hay página de gracias donde dispare
  // el píxel, así que la campaña que la trajo se ve peor de lo que fue.
  void contarLaVenta(db, {
    workspaceId: args.workspaceId,
    orderId: res.external_id,
    conversationId: espejo.conversationId ?? null,
    total: res.total,
    currency: res.currency,
    cliente: {
      email: args.cliente.email ?? null,
      phone: args.cliente.phone ?? null,
      nombre: args.cliente.name ?? null,
      ciudad: args.cliente.address?.city ?? null,
      provincia: args.cliente.address?.province ?? null,
      pais: args.cliente.address?.country ?? null,
    },
  })

  return res
}
