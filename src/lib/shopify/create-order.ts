/**
 * Helper para la tool `create_order` del asistente IA.
 *
 * A diferencia de `create_checkout` (que sólo arma un cart-permalink y
 * delega TODO en el checkout hospedado de Shopify), esto crea un PEDIDO
 * REAL vía Admin API (`POST /admin/api/{v}/orders.json`) y devuelve el
 * número de pedido + el order_status_url. El pedido queda visible en el
 * admin de Shopify al instante y el llamador lo refleja además en la
 * tabla `orders` de Riverz.
 *
 * Requiere el scope `write_orders` (ver src/lib/shopify/oauth.ts) — las
 * tiendas conectadas con el scope viejo (solo lectura) deben reconectar.
 *
 * Pago: el pedido se crea con `financial_status: 'pending'` (sin captura
 * de tarjeta — la Admin API no cobra). Encaja con el flujo LatAm de
 * contra-entrega / transferencia: el equipo confirma el cobro luego. El
 * webhook orders/create/updated reconcilia el estado sobre la fila.
 *
 * Modos (igual que create-checkout, para no romper la economía de Pilar):
 *   - BUNDLE MODE (config.offers tiene elementos): el modelo pasa `offer`;
 *     de ahí salen qty/total. Como la Cart Function de bundles NO corre en
 *     pedidos creados por Admin API, fijamos el precio de línea =
 *     total/qty para que el total del pedido coincida con la oferta.
 *   - AUTO MODE (sin offers): cotizamos `quantity` al precio real del
 *     variant (no override; Shopify usa el precio del variant).
 */

import type {
  CheckoutConfig,
  CheckoutOfferConfig,
  PaymentHint,
} from './create-checkout'

/** Dirección de envío que el modelo puede pasar (todos opcionales). */
export interface ShippingAddressInput {
  address1?: string
  address2?: string
  city?: string
  province?: string
  zip?: string
  country?: string
}

export interface CreateOrderInput {
  /** Clave de la oferta elegida (BUNDLE MODE). */
  offer?: string
  /** Unidades pedidas (AUTO MODE). */
  quantity?: number
  /**
   * Qué lleva, cuando el modelo lo dice explícitamente.
   *
   * La ficha de la herramienta se lo pide desde siempre, y acá se ignoraba: el
   * variant salía del producto detectado en la conversación o del único
   * configurado en la cuenta. En un catálogo con veinte productos, pedir
   * cualquier otro terminaba en "no pude resolver el producto de esta tienda"
   * —un mensaje que encima culpa a la tienda—. Medido el 2026-08-24.
   */
  items?: Array<{ variant_id?: string; quantity?: number }>
  payment_hint?: PaymentHint
  customer_name?: string
  customer_phone?: string
  customer_email?: string
  shipping_address?: ShippingAddressInput
  note?: string
}

export interface CreateOrderContext {
  shopDomain: string
  accessToken: string
  apiVersion: string
  /** Variant id del producto detectado (productMatch en el runner). Si
   *  null, caemos a config.default_variant_id. */
  pinnedVariantId?: string | null
  /** Teléfono/email del contacto, prellenados desde la conversación. */
  customerPhone?: string | null
  customerEmail?: string | null
  config?: CheckoutConfig | null
  /** Divisa canónica del workspace ya resuelta por el runner. Fallback de la
   *  divisa del pedido cuando la config no fija una (evita el 'ARS' hardcodeado). */
  currency?: string | null
}

export interface CreateOrderResult {
  shopify_order_id: string
  order_number: string
  order_status_url: string | null
  currency: string
  total_price: number | null
  offer_label: string
  line_items: Array<{ title: string; quantity: number; price: number | null }>
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  shipping_address: ShippingAddressInput | null
  payment_method: PaymentHint
  next_step_for_pili: string
}

export type CreateOrderError = { error: string; message: string }

/** Variant tal cual lo devuelve la Admin API (campos que usamos). */
interface ShopifyVariantInfo {
  title?: string
  price?: string | number
  inventory_quantity?: number
  inventory_policy?: string
  inventory_management?: string | null
  product_id?: number
}

interface ShopifyCreatedOrder {
  id: number
  name?: string
  order_number?: number
  order_status_url?: string | null
  total_price?: string | number
  currency?: string
}

/**
 * Punto de entrada. Resuelve variant + precios, crea el pedido en Shopify
 * y devuelve un objeto compacto que el modelo parafrasea para la clienta.
 * NO toca la base de Riverz — eso lo hace el llamador (tools.ts).
 */
export async function createShopifyOrder(
  input: CreateOrderInput,
  ctx: CreateOrderContext,
): Promise<CreateOrderResult | CreateOrderError> {
  const config = ctx.config ?? null
  const offers = config?.offers ?? null
  const bundleMode = !!(config?.enabled && offers && offers.length > 0)

  // ── Oferta / cantidad ─────────────────────────────────────────────
  let qty: number
  let offerLabel: string
  let matchedOffer: CheckoutOfferConfig | null = null
  if (bundleMode) {
    matchedOffer = (offers ?? []).find((o) => o.key === input.offer) ?? null
    if (!matchedOffer) {
      const valid = (offers ?? []).map((o) => o.key).join(' | ')
      return {
        error: 'invalid_offer',
        message: `Oferta "${input.offer ?? ''}" no reconocida. Usa ${valid}.`,
      }
    }
    qty = matchedOffer.qty
    offerLabel = matchedOffer.label
  } else {
    qty = input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : 1
    offerLabel = qty === 1 ? '1 unidad' : `${qty} unidades`
  }

  // ── Variant ───────────────────────────────────────────────────────
  // Lo que el modelo dijo manda sobre lo detectado y sobre el default: si la
  // clienta pidió ESE producto, el pedido es de ese producto.
  const pedidos = (input.items ?? [])
    .map((i) => ({
      variant_id: String(i.variant_id ?? '').trim(),
      quantity: Math.max(1, Math.floor(Number(i.quantity ?? 1)) || 1),
    }))
    .filter((i) => /^\d+$/.test(i.variant_id))

  const variantId =
    pedidos[0]?.variant_id ||
    (ctx.pinnedVariantId && ctx.pinnedVariantId.trim()) ||
    (config?.default_variant_id && config.default_variant_id.trim()) ||
    null
  if (!variantId) {
    return {
      error: 'no_variant',
      message:
        'No pude resolver el producto de esta tienda para crear el pedido. Pide ayuda al equipo humano.',
    }
  }

  // ── Precio real + chequeo de stock (best-effort, fail-open) ────────
  let variantInfo: ShopifyVariantInfo | null = null
  try {
    const fields =
      'title,price,inventory_quantity,inventory_policy,inventory_management,product_id'
    const vUrl = `https://${ctx.shopDomain}/admin/api/${ctx.apiVersion}/variants/${variantId}.json?fields=${fields}`
    const vRes = await fetch(vUrl, {
      headers: {
        'X-Shopify-Access-Token': ctx.accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (vRes.ok) {
      const { variant } = (await vRes.json()) as { variant?: ShopifyVariantInfo }
      variantInfo = variant ?? null
    } else {
      console.warn('[shopify] variant fetch non-ok (stock check skipped):', {
        variantId,
        status: vRes.status,
        domain: ctx.shopDomain,
      })
    }
  } catch (err) {
    // fail-open: si no pudimos leer el variant, igual intentamos crear.
    // Shopify igual aplica su política de inventario al crear el pedido
    // (inventory_behaviour). Logueamos para no perder visibilidad.
    console.warn('[shopify] variant fetch failed (stock check skipped):', {
      variantId,
      domain: ctx.shopDomain,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (
    variantInfo?.inventory_management &&
    variantInfo.inventory_policy === 'deny' &&
    typeof variantInfo.inventory_quantity === 'number' &&
    variantInfo.inventory_quantity < qty
  ) {
    return {
      error: 'out_of_stock',
      message: `No hay stock suficiente para ${offerLabel} (quedan ${variantInfo.inventory_quantity}). Ofrece otra cantidad o lista de espera; no crees el pedido.`,
    }
  }

  // ── Precio de línea ────────────────────────────────────────────────
  // BUNDLE MODE: override = total/qty para que el total del pedido coincida
  // con la oferta curada (la Cart Function de bundles no corre en pedidos
  // de Admin API). AUTO MODE: NO mandamos precio — Shopify usa el precio
  // real y vivo del variant (y respeta cualquier descuento automático);
  // sólo leemos el precio del variant para mostrarlo/totalizar.
  let linePriceOverride: number | null = null
  if (bundleMode && matchedOffer) {
    linePriceOverride = round2(matchedOffer.total / qty)
  }
  let autoUnitPrice: number | null = null
  if (!bundleMode && variantInfo?.price != null) {
    const p =
      typeof variantInfo.price === 'number'
        ? variantInfo.price
        : parseFloat(variantInfo.price)
    if (!Number.isNaN(p)) autoUnitPrice = p
  }
  const unitPrice = linePriceOverride ?? autoUnitPrice

  const currency = config?.currency || ctx.currency || 'ARS'
  const paymentHint: PaymentHint = input.payment_hint ?? 'card_or_mp'

  // ── Datos del cliente ─────────────────────────────────────────────
  const name = (input.customer_name ?? '').trim()
  const { first_name, last_name } = splitName(name)
  const phone = (input.customer_phone ?? ctx.customerPhone ?? '').trim() || undefined
  const email = (input.customer_email ?? ctx.customerEmail ?? '').trim() || undefined

  const shipping = normalizeAddress(input.shipping_address, {
    first_name,
    last_name,
    phone,
  })

  // ── Descuento por transferencia (informativo, no se pre-resta) ─────
  const transferAmount =
    typeof config?.transfer_discount_amount === 'number'
      ? config.transfer_discount_amount
      : null
  const transferLabel = config?.transfer_discount_label || 'transferencia'
  const hasTransferDiscount =
    paymentHint === 'transfer' && transferAmount != null && transferAmount > 0

  const noteParts: string[] = ['Pedido creado por el asistente IA de Riverz.']
  if (input.note && input.note.trim()) noteParts.push(input.note.trim())
  if (hasTransferDiscount) {
    noteParts.push(
      `Pago por ${transferLabel}: aplicar crédito de ${transferAmount} ${currency} al confirmar.`,
    )
  }

  const tags = ['riverz-ia']
  if (hasTransferDiscount) tags.push(transferLabel)

  // ── Payload del pedido ─────────────────────────────────────────────
  // variant_id va como STRING: los ids de Shopify son enteros de 64 bits
  // que pueden exceder Number.MAX_SAFE_INTEGER (2^53-1), y Number()
  // perdería precisión → pediríamos el variant equivocado. La Admin API
  // acepta el id como string.
  const lineItem: Record<string, unknown> = {
    variant_id: variantId,
    quantity: qty,
  }
  // Sólo forzamos precio en BUNDLE MODE; en AUTO lo decide Shopify.
  if (linePriceOverride != null) lineItem.price = String(linePriceOverride)

  // Con varios productos van todos. La oferta y el precio forzado son de la
  // pieza única que configura el comercio, así que ahí no aplican: el precio lo
  // pone Shopify, que es el que está vivo.
  const lineas =
    pedidos.length > 1
      ? pedidos.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }))
      : [lineItem]

  const orderPayload: Record<string, unknown> = {
    line_items: lineas,
    financial_status: 'pending',
    // Descuenta inventario respetando la política de la tienda.
    inventory_behaviour: 'decrement_obeying_policy',
    // No mandamos el email de Shopify automáticamente: el seguimiento lo
    // hace el asistente por el chat.
    send_receipt: false,
    send_fulfillment_receipt: false,
    currency,
    tags: tags.join(', '),
    note: noteParts.join(' '),
  }
  if (email) orderPayload.email = email
  if (phone) orderPayload.phone = phone
  const customer: Record<string, unknown> = {}
  if (first_name) customer.first_name = first_name
  if (last_name) customer.last_name = last_name
  if (email) customer.email = email
  if (phone) customer.phone = phone
  if (Object.keys(customer).length) orderPayload.customer = customer
  if (shipping) orderPayload.shipping_address = shipping

  // ── Crear el pedido ────────────────────────────────────────────────
  let created: ShopifyCreatedOrder
  try {
    const url = `https://${ctx.shopDomain}/admin/api/${ctx.apiVersion}/orders.json`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': ctx.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ order: orderPayload }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // 403/401 típico: falta el scope write_orders (tienda sin reconectar).
      if (res.status === 401 || res.status === 403) {
        return {
          error: 'missing_write_scope',
          message:
            'No tengo permiso para crear pedidos en esta tienda (falta reconectar Shopify con permisos de pedidos). No prometas el pedido; avisa que una persona del equipo lo arma.',
        }
      }
      return {
        error: 'shopify_order_failed',
        message: `No pude crear el pedido en Shopify (${res.status}). ${text.slice(0, 200)}`,
      }
    }
    const data = (await res.json()) as { order?: ShopifyCreatedOrder }
    if (!data.order?.id) {
      return {
        error: 'shopify_order_failed',
        message: 'Shopify no devolvió un pedido válido.',
      }
    }
    created = data.order
  } catch (err) {
    return {
      error: 'shopify_order_failed',
      message: `Error de red al crear el pedido: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  const total =
    created.total_price != null
      ? typeof created.total_price === 'number'
        ? created.total_price
        : parseFloat(created.total_price)
      : unitPrice != null
        ? round2(unitPrice * qty)
        : null

  const title = (variantInfo?.title && variantInfo.title.trim()) || offerLabel
  // Shopify casi siempre devuelve `name` (#1042) u `order_number`; si por
  // algún borde llegaran vacíos, caemos al id interno (garantizado) para
  // que la clienta siempre tenga una referencia.
  const orderNumber =
    (created.name ||
      (created.order_number != null ? String(created.order_number) : '')).trim() ||
    String(created.id)
  const nextStep = hasTransferDiscount
    ? `Pedido ${orderNumber} creado. Avísale que el total se confirma al validar la ${transferLabel} (crédito de ${transferAmount} ${currency}).`
    : `Pedido ${orderNumber} creado. Confirmale el número y los próximos pasos de pago/entrega.`

  return {
    shopify_order_id: String(created.id),
    order_number: orderNumber,
    order_status_url: created.order_status_url ?? null,
    currency: created.currency || currency,
    total_price: total != null && !Number.isNaN(total) ? total : null,
    offer_label: offerLabel,
    line_items: [{ title, quantity: qty, price: unitPrice }],
    customer_name: name || null,
    customer_phone: phone ?? null,
    customer_email: email ?? null,
    shipping_address: input.shipping_address ?? null,
    payment_method: paymentHint,
    next_step_for_pili: nextStep,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

function normalizeAddress(
  addr: ShippingAddressInput | undefined,
  who: { first_name?: string; last_name?: string; phone?: string },
): Record<string, unknown> | null {
  if (!addr) return null
  const out: Record<string, unknown> = {}
  if (addr.address1?.trim()) out.address1 = addr.address1.trim()
  if (addr.address2?.trim()) out.address2 = addr.address2.trim()
  if (addr.city?.trim()) out.city = addr.city.trim()
  if (addr.province?.trim()) out.province = addr.province.trim()
  if (addr.zip?.trim()) out.zip = addr.zip.trim()
  if (addr.country?.trim()) out.country = addr.country.trim()
  // Sin al menos una línea de dirección no mandamos shipping_address.
  if (!out.address1 && !out.city) return null
  if (who.first_name) out.first_name = who.first_name
  if (who.last_name) out.last_name = who.last_name
  if (who.phone) out.phone = who.phone
  return out
}
