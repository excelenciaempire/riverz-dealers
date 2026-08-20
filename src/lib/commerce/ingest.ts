import type { SupabaseClient } from '@supabase/supabase-js'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { maybeAutoVoiceCall } from '@/lib/voice/auto-enqueue'
import { upsertWhatsappContact } from '@/lib/shopify/contact-upsert'
import { applyCategoryTags } from '@/lib/contacts/tags'
import { linkOrphanPurchases, recordPurchases } from '@/lib/contacts/purchases'
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking'
import {
  normalizeToWhatsApp,
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'
import type { AutomationTriggerType } from '@/types'
import type {
  CommercePlatform,
  NormalizedCheckout,
  NormalizedCustomer,
  NormalizedOrder,
} from './types'

/**
 * Ingesta de pedidos y carritos, común a las tres plataformas.
 *
 * Decisión central: NO inventamos triggers nuevos por plataforma. Un
 * pedido de Tiendanube dispara el MISMO `shopify_order_created` que uno
 * de Shopify, así que toda automatización que el comercio ya tenía
 * armada (confirmación de pedido, aviso de despacho, recuperación de
 * carrito) funciona sobre la tienda nueva sin que toque nada. El nombre
 * del trigger arrastra "shopify" por historia; su significado es
 * "pedido creado en la tienda conectada".
 *
 * Las tablas de estado (`shopify_order_fulfillment_state`) y sus RPC de
 * claim/transición están tipadas por (shop_domain TEXT, order_id BIGINT),
 * ambas genéricas, así que la deduplicación y el cálculo de transiciones
 * se reutilizan tal cual.
 */

/** Teléfono del comprador en E.164, o null si no hay uno utilizable. */
function resolvePhone(customer: NormalizedCustomer): string | null {
  if (!customer.phone) return null
  const phone = normalizeToWhatsApp(customer.phone, customer.countryCode ?? '')
  return isValidE164(phone) ? phone : null
}

/**
 * La forma en que se guardaban los teléfonos ANTES de normalizar por
 * país. Se pasa al upsert de contactos para que un comprador creado bajo
 * la clave vieja (un móvil argentino sin +54) se migre en lugar de
 * duplicarse.
 */
function legacyPhone(customer: NormalizedCustomer): string {
  return customer.phone ? sanitizePhoneForMeta(customer.phone) : ''
}

/**
 * Decide qué evento disparar para un pedido, usando los mismos RPC que
 * el receptor de Shopify.
 *
 * `isCreate` distingue el alta (que hace claim exclusivo y siembra el
 * estado inicial) de una actualización (que compara contra el estado
 * previo bajo un lock de fila, de modo que dos entregas simultáneas no
 * observen las dos la misma transición).
 *
 * Devuelve null cuando no hay nada que anunciar — el caso normal en la
 * mayoría de las actualizaciones.
 */
export async function resolveOrderTrigger(
  admin: SupabaseClient,
  args: { shopDomain: string; order: NormalizedOrder; isCreate: boolean },
): Promise<AutomationTriggerType | null> {
  const { shopDomain, order, isCreate } = args
  const orderId = order.externalId
  if (!(orderId > 0)) return null

  if (isCreate) {
    const { data: claimed } = await admin.rpc('shopify_claim_order_created', {
      p_shop_domain: shopDomain,
      p_order_id: orderId,
      p_fulfillment_status: order.state.fulfillmentStatus,
    })
    // false = ya vimos este pedido. Sin este claim, una segunda entrega
    // del MISMO pedido (no un reintento de la misma entrega, que ya
    // filtra el dedupe por id) volvería a mandar la confirmación.
    if (claimed !== true) return null
    return 'shopify_order_created'
  }

  const { data: transition } = await admin.rpc(
    'shopify_record_fulfillment_transition',
    {
      p_shop_domain: shopDomain,
      p_order_id: orderId,
      p_fulfillment_status: order.state.fulfillmentStatus,
      p_shipment_status: order.state.delivered ? 'delivered' : null,
      p_just_delivered: order.state.delivered,
      p_financial_status: order.state.financialStatus,
      p_cancelled: order.state.cancelled,
    },
  )
  const row = Array.isArray(transition)
    ? (transition[0] as
        | {
            transitioned_to_fulfilled?: boolean
            transitioned_to_delivered?: boolean
            transitioned_to_paid?: boolean
            transitioned_to_cancelled?: boolean
            transitioned_to_refunded?: boolean
          }
        | undefined)
    : null
  if (!row) return null

  // Una actualización anuncia UN solo evento. Prioridad: las excepciones
  // (cancelado/reembolsado) antes que el avance normal del pedido.
  if (row.transitioned_to_cancelled) return 'shopify_order_cancelled'
  if (row.transitioned_to_refunded) return 'shopify_order_refunded'
  if (row.transitioned_to_paid) return 'shopify_order_paid'
  if (row.transitioned_to_fulfilled) return 'shopify_order_fulfilled'
  if (row.transitioned_to_delivered) return 'shopify_order_delivered'
  return null
}

/** Variables que quedan disponibles en plantillas y automatizaciones. */
export function buildOrderVars(
  trigger: AutomationTriggerType,
  order: NormalizedOrder,
  platform?: CommercePlatform,
): Record<string, string> {
  const vars: Record<string, string> = {
    // De qué tienda vino. Disponible como variable y como criterio de
    // condición, para que un comercio con dos plataformas conectadas pueda
    // mandar mensajes distintos según cuál vendió.
    platform: platform ?? '',
    customer_name: order.customer.name ?? '',
    order_id: String(order.externalId),
    order_name: order.name,
    order_number: order.orderNumber,
    total_price: order.totalPrice,
    subtotal_price: order.subtotalPrice,
    total_discounts: order.totalDiscounts,
    currency: order.currency,
    item_count: String(order.lineItems.length),
    first_item: order.lineItems[0]?.title ?? '',
    is_repeat_customer: order.customer.ordersCount > 1 ? 'true' : 'false',
    order_status_url: order.orderStatusUrl,
    financial_status: order.state.financialStatus ?? '',
    fulfillment_status: order.state.fulfillmentStatus ?? '',
    shipping_address: order.shippingAddress.address,
    shipping_city: order.shippingAddress.city,
    shipping_province: order.shippingAddress.province,
    shipping_zip: order.shippingAddress.zip,
    shipping_country: order.shippingAddress.country,
  }

  if (
    trigger === 'shopify_order_fulfilled' ||
    trigger === 'shopify_order_delivered'
  ) {
    vars.tracking_number = order.trackingNumber
    vars.tracking_company = order.trackingCompany
    // Ni Tiendanube ni WooCommerce arman el link de seguimiento para los
    // correos locales (Andreani, OCA, Correo Argentino): mandan el número
    // pelado. El resolvedor propio evita que el cliente reciba un código
    // sin nada donde pegarlo.
    vars.tracking_url =
      order.trackingUrl ||
      resolveCarrierTrackingUrl(order.trackingCompany, order.trackingNumber) ||
      ''
  }

  return vars
}

export interface OrderIngestResult {
  status:
    | 'dispatched'
    | 'no_transition'
    | 'no_phone'
    | 'no_contact'
  trigger?: AutomationTriggerType
  contactId?: string
}

/**
 * Procesa un pedido de punta a punta: decide el evento, asegura el
 * contacto, lo categoriza, espeja el pedido y dispara automatizaciones.
 *
 * Nota sobre pedidos sin teléfono: se registran igual (el espejo y el
 * cierre del carrito ya ocurrieron) pero no disparan nada, porque todo
 * lo que Riverz puede hacer con un pedido pasa por escribirle al
 * comprador.
 */
export async function ingestOrder(
  admin: SupabaseClient,
  args: {
    platform: CommercePlatform
    workspaceId: string
    shopDomain: string
    order: NormalizedOrder
    isCreate: boolean
  },
): Promise<OrderIngestResult> {
  const { platform, workspaceId, shopDomain, order, isCreate } = args

  const trigger = await resolveOrderTrigger(admin, {
    shopDomain,
    order,
    isCreate,
  })

  if (isCreate) {
    // Cerrar el carrito que originó el pedido, si lo teníamos guardado.
    // En una compra directa no existe la fila y el update es un no-op.
    if (order.checkoutToken) {
      await admin
        .from('shopify_checkouts')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('shop_domain', shopDomain)
        .eq('checkout_id', order.checkoutToken)
    }
  }
  await reconcileOrder(admin, { shopDomain, order })
  await trackUnpaidOrder(admin, { platform, workspaceId, shopDomain, order })

  // Historial de compras del contacto (migración 172). Antes del corte por
  // trigger: un pedido sin transición que anunciar sigue siendo una compra, y
  // la ficha del cliente tiene que poder mostrarla.
  await recordPurchases(admin, workspaceId, [
    {
      platform,
      shopDomain,
      externalId: order.externalId,
      orderNumber: order.name || order.orderNumber || null,
      placedAt: order.createdAt,
      currency: order.currency,
      total: order.totalPrice,
      financialStatus: order.state.financialStatus,
      fulfillmentStatus: order.state.fulfillmentStatus,
      lineItems: order.lineItems.map((li) => ({
        title: li.title,
        quantity: li.quantity,
        price: li.price,
      })),
      customerEmail: order.customer.email,
      customerPhone: order.customer.phone,
    },
  ]).catch((err) => console.error(`[${platform}] historial de compras falló:`, err))

  if (!trigger) return { status: 'no_transition' }

  const phone = resolvePhone(order.customer)
  if (!phone) return { status: 'no_phone', trigger }

  const contactId = await upsertWhatsappContact(admin, {
    workspaceId,
    phone,
    name: order.customer.name ?? undefined,
    email: order.customer.email ?? undefined,
    legacyExternalId: legacyPhone(order.customer),
  })
  if (!contactId) return { status: 'no_contact', trigger }

  // Enganchar al contacto este pedido y cualquier compra anterior del mismo
  // email o teléfono que se hubiera guardado antes de que el contacto existiera.
  await linkOrphanPurchases(admin, workspaceId, {
    id: contactId,
    email: order.customer.email,
    phone,
  }).catch((err) => console.error(`[${platform}] enganche de compras falló:`, err))

  // Dejar el contacto pegado al estado del pedido para que el cron de
  // feedback post-entrega le escriba a QUIEN hizo ESTE pedido, en vez de
  // adivinar por el despacho más reciente del workspace.
  if (order.externalId > 0) {
    await admin
      .from('shopify_order_fulfillment_state')
      .update({ contact_id: contactId })
      .eq('shop_domain', shopDomain)
      .eq('order_id', order.externalId)
  }

  if (trigger === 'shopify_order_created') {
    const firstItem = order.lineItems[0]?.title?.trim()
    if (firstItem) {
      await admin
        .from('contacts')
        .update({ last_product: firstItem })
        .eq('id', contactId)
    }
  }

  // Categorización (comprador / recurrente / unidades) para que el
  // comprador quede seleccionable en segmentos y campañas. No envía nada.
  try {
    const units = order.lineItems.reduce(
      (sum, li) => sum + (Number(li.quantity) || 0),
      0,
    )
    await applyCategoryTags(admin, workspaceId, contactId, {
      ordersCount: order.customer.ordersCount > 0 ? order.customer.ordersCount : 1,
      isAbandoned: false,
      units,
    })
  } catch (err) {
    console.error(`[${platform}] categorizar comprador falló:`, err)
  }

  const vars = buildOrderVars(trigger, order, platform)

  runAutomationsForTrigger({
    workspaceId,
    triggerType: trigger,
    contactId,
    context: { vars },
  }).catch((err) => console.error(`[${platform}] disparo de automatización falló:`, err))

  if (trigger === 'shopify_order_created') {
    void maybeAutoVoiceCall(admin, {
      workspaceId,
      contactId,
      callType: 'order_confirmation',
      context: vars,
    })
  }

  return { status: 'dispatched', trigger, contactId }
}

/**
 * Convierte un pedido que quedó SIN COBRAR en un carrito recuperable.
 *
 * WooCommerce no tiene carritos abandonados en el núcleo, pero sí crea un
 * pedido en estado `pending` o `failed` cuando alguien aprieta "realizar
 * pedido" y el pago no prospera (tarjeta rechazada, abandono en la
 * pasarela, transferencia que nunca llega). Ese pedido trae teléfono,
 * correo, productos y —lo decisivo— un link que lleva directo a pagarlo.
 * Es un abandono real y hasta ahora se perdía.
 *
 * Se escribe en la misma tabla que el resto de los carritos, así que el
 * cron de recuperación lo levanta sin saber de dónde salió: espera sus 2
 * horas, aplica el antispam por teléfono y manda el mensaje.
 *
 * Cubre a quien llegó a enviar el pedido. Para quien abandona ANTES de
 * eso está el plugin de WordPress, que captura el checkout en curso
 * (`/api/woocommerce/webhooks/cart`).
 */
async function trackUnpaidOrder(
  admin: SupabaseClient,
  args: {
    platform: CommercePlatform
    workspaceId: string
    shopDomain: string
    order: NormalizedOrder
  },
): Promise<void> {
  const { platform, workspaceId, shopDomain, order } = args
  // Sin link de pago no hay recuperación posible: el mensaje no tendría a
  // dónde mandar a la persona.
  if (!order.payUrl) return

  // Prefijo propio para no chocar nunca con la clave de un carrito real
  // capturado por el plugin.
  const checkoutId = `order:${order.externalId}`
  const { financialStatus, fulfillmentStatus, cancelled } = order.state

  const recoverable =
    !cancelled &&
    fulfillmentStatus !== 'fulfilled' &&
    (financialStatus === 'pending' || financialStatus === 'voided')

  if (!recoverable) {
    // Pagó, se despachó o se canceló: cerramos el carrito para que el cron
    // no le escriba "dejaste tu compra a medias" a alguien que ya pagó.
    const now = new Date().toISOString()
    await admin
      .from('shopify_checkouts')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .eq('shop_domain', shopDomain)
      .eq('checkout_id', checkoutId)
      .is('completed_at', null)
    return
  }

  await ingestCheckout(admin, {
    platform,
    workspaceId,
    shopDomain,
    checkout: {
      checkoutId,
      customer: order.customer,
      totalPrice: Number.isFinite(parseFloat(order.totalPrice))
        ? parseFloat(order.totalPrice)
        : null,
      currency: order.currency || null,
      lineItems: order.lineItems,
      recoveryUrl: order.payUrl,
      completedAt: null,
      // El reloj del abandono corre desde el alta del pedido, no desde que
      // nos enteramos: si no, un pedido descubierto tarde arrancaría de
      // cero y el recordatorio saldría con horas de retraso.
      createdAt: order.createdAt,
    },
  })
}

/**
 * Actualiza el espejo del pedido en la tabla `orders`.
 *
 * IMPORTANTE: solo ACTUALIZA, nunca inserta. `orders` significa "pedidos
 * que originó el asistente" —es lo que muestra /pedidos— así que volcar
 * ahí todos los pedidos de la tienda cambiaría el sentido de esa página
 * y la llenaría de ventas que Riverz no generó. Es exactamente el mismo
 * criterio que aplica el receptor de Shopify: si el pedido no lo creó la
 * IA no hay fila que matchear y el update es un no-op.
 *
 * `shopify_order_id` guarda el id del pedido en SU plataforma (el nombre
 * de la columna quedó por compatibilidad, ver migración 126).
 */
async function reconcileOrder(
  admin: SupabaseClient,
  args: { shopDomain: string; order: NormalizedOrder },
): Promise<void> {
  const { shopDomain, order } = args
  const total = parseFloat(order.totalPrice)
  const update: Record<string, unknown> = {
    fulfillment_status: order.state.fulfillmentStatus,
    status: deriveOrderStatus(order),
    updated_at: new Date().toISOString(),
  }
  // `financial_status` es NOT NULL en la tabla: si la plataforma todavía
  // no informa estado de pago dejamos el valor previo en lugar de
  // intentar escribir null y que falle el update entero.
  if (order.state.financialStatus) {
    update.financial_status = order.state.financialStatus
  }
  if (Number.isFinite(total)) update.total_price = total
  if (order.orderStatusUrl) update.order_status_url = order.orderStatusUrl
  // Vínculo exacto con el carrito que cerró (migración 128): es la clave de
  // `shopify_checkouts`, y sin él la atribución no puede distinguir la misma
  // compra vista por los dos caminos de dos compras distintas del cliente.
  if (order.checkoutToken) update.checkout_token = order.checkoutToken

  await admin
    .from('orders')
    .update(update)
    .eq('shop_domain', shopDomain)
    .eq('shopify_order_id', String(order.externalId))
}

/**
 * Ciclo de vida del pedido del lado de Riverz. Los valores están atados
 * al CHECK de la migración 080 — 'created' es el estado inicial, no
 * existe 'pending'.
 */
function deriveOrderStatus(order: NormalizedOrder): string {
  const { financialStatus, fulfillmentStatus, cancelled } = order.state
  if (cancelled) return 'cancelled'
  if (financialStatus === 'refunded') return 'refunded'
  if (financialStatus === 'voided') return 'cancelled'
  if (fulfillmentStatus === 'fulfilled') return 'fulfilled'
  if (financialStatus === 'paid') return 'paid'
  return 'created'
}

/**
 * Guarda un carrito abandonado en `shopify_checkouts`.
 *
 * No dispara nada: el cron `/api/cron/shopify-cart-recovery` escanea esa
 * tabla sin filtrar por plataforma y decide cuándo un carrito está
 * realmente abandonado (2h sin completar), aplica el antispam por
 * teléfono y dispara la recuperación. Escribir acá es todo lo que hace
 * falta para que la recuperación funcione en una tienda nueva.
 */
export async function ingestCheckout(
  admin: SupabaseClient,
  args: {
    platform: CommercePlatform
    workspaceId: string
    shopDomain: string
    checkout: NormalizedCheckout
  },
): Promise<{ persisted: boolean }> {
  const { platform, workspaceId, shopDomain, checkout } = args
  if (!checkout.checkoutId) return { persisted: false }

  const phone = resolvePhone(checkout.customer)

  const row: Record<string, unknown> = {
    platform,
    workspace_id: workspaceId,
    shop_domain: shopDomain,
    checkout_id: checkout.checkoutId,
    customer_email: checkout.customer.email,
    customer_phone: phone,
    customer_name: checkout.customer.name,
    total_price: checkout.totalPrice,
    currency: checkout.currency,
    line_items: checkout.lineItems.map((li) => ({
      title: li.title,
      quantity: li.quantity,
      price: li.price,
      variant_id: li.variantId,
      product_id: li.productId,
      image_url: li.imageUrl,
    })),
    abandoned_checkout_url: checkout.recoveryUrl,
    status: checkout.completedAt ? 'completed' : 'open',
    completed_at: checkout.completedAt,
    updated_at: new Date().toISOString(),
  }
  // `created_at` viene de la plataforma porque el cron mide la ventana de
  // abandono contra ESA fecha. Usar la hora de ingesta haría que un
  // carrito descubierto por el polling recién horas después arrancara el
  // reloj de cero y el recordatorio saliera tardísimo.
  if (checkout.createdAt) row.created_at = checkout.createdAt

  const { error } = await admin
    .from('shopify_checkouts')
    .upsert(row, { onConflict: 'shop_domain,checkout_id' })
  if (error) {
    console.error(`[${platform}] alta de carrito falló:`, error.message)
    return { persisted: false }
  }
  return { persisted: true }
}
