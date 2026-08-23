/**
 * Helper para la tool `create_checkout` del asistente IA.
 *
 * Devuelve un link de Shopify cart-permalink (`/cart/{variant_id}:{qty}`)
 * que dispara automáticamente cualquier descuento por bundle que la
 * tienda tenga configurado vía Shopify Functions (en particular Käching
 * Bundles, que es la app que Pilar Argentina usa para el "2+1 GRATIS" /
 * "3+1 GRATIS" del Sérum Pilar).
 *
 * El comportamiento es PER-WORKSPACE, gobernado por una fila de
 * `workspace_checkout_config` que el runner carga y pasa en `ctx.config`:
 *
 *   - BUNDLE MODE (config.offers tiene elementos): igual que Pilar hoy.
 *     La oferta elegida (`input.offer`) matchea contra config.offers[].key
 *     y de ahí salen qty/label/total/compare_at. El cart-permalink usa la
 *     cantidad del bundle; la Cart Function de la tienda re-escribe el
 *     precio en checkout mirando sólo (variant_id, quantity).
 *
 *   - AUTO MODE (sin offers): cotizamos el precio REAL del variant en
 *     Shopify × `input.quantity`. Sin compare-at, sin descuentos
 *     inventados. La moneda sale de la tienda (/shop.json) si la config
 *     no la fija.
 *
 * Recon verificado contra pilarargentina.store (15-jun-2026):
 *   - qty=1 → 1 unidad a $39.990 ARS (precio promo).
 *   - qty=3 → 3 unidades a $69.900 ARS total (descuento "2 Unidades + 1 GRATIS").
 *   - qty=4 → 4 unidades a $99.900 ARS total (descuento "3 Unidades + 1 GRATIS").
 *
 * La Cart Function de Käching Bundles re-escribe el precio en checkout
 * mirando sólo (variant_id, quantity) — NO se necesita ningún line-item
 * property, código de descuento, ni llamada al app-proxy. Por eso esta
 * tool simplemente arma el cart-permalink crudo.
 *
 * Para el descuento por transferencia: NO hay código en Shopify (el
 * equipo lo aplica manualmente al confirmar la transferencia bancaria),
 * así que mandamos cart-attributes que avisan al backoffice + la
 * respuesta para Pili explica el flujo.
 */

export type PaymentHint = 'card_or_mp' | 'transfer'

/** Una oferta de bundle, tal como vive en `workspace_checkout_config.offers`. */
export interface CheckoutOfferConfig {
  key: string
  label: string
  qty: number
  total: number
  compare_at?: number | null
}

/** Fila de `workspace_checkout_config` (la pasa el runner en `ctx.config`). */
export interface CheckoutConfig {
  enabled: boolean
  currency: string | null
  offers: CheckoutOfferConfig[] | null
  transfer_discount_amount: number | null
  transfer_discount_label: string | null
  payment_methods: string[] | null
  default_variant_id: string | null
}

export interface CreateCheckoutInput {
  /** Clave de la oferta elegida (BUNDLE MODE). */
  offer?: string
  /** Unidades pedidas (AUTO MODE). */
  quantity?: number
  /**
   * Varios productos en un mismo carrito.
   *
   * Sin esto, el agente sólo podía armar un carrito de UN producto: quien
   * quería llevar el serum y la crema recibía dos enlaces, y el segundo pisaba
   * al primero — un enlace de carrito reemplaza el carrito entero. Terminaba
   * comprando una sola cosa, que es exactamente la venta que el chat debería
   * hacer crecer.
   *
   * Shopify acepta varias líneas en el mismo permalink
   * (`/cart/v1:q1,v2:q2`); esto es sólo pasárselas.
   *
   * Tiene precedencia sobre `offer` y `quantity`: cuando el modelo nombra
   * productos concretos, eso es lo que la clienta pidió.
   */
  items?: Array<{ variant_id: string; quantity?: number }>
  /**
   * Cupón ya emitido para esta persona (`ofrecer_descuento`).
   *
   * Shopify lo aplica solo si viaja en el propio enlace: sin esto la clienta
   * tenía que acordarse de tipearlo en el checkout, que es justo donde se
   * pierde la venta que el descuento venía a rescatar.
   */
  discount_code?: string
  payment_hint?: PaymentHint
}

export interface CreateCheckoutContext {
  /** Dominio admin (*.myshopify.com) del workspace. */
  shopDomain: string
  /** Access token Shopify Admin. Se usa para resolver el dominio público
   *  de la storefront vía /shop.json y, en AUTO MODE, el precio del variant. */
  accessToken: string
  apiVersion: string
  /** Variant id del producto que el cliente está mencionando — viene
   *  del productMatch en el runner. Si null, caemos a
   *  config.default_variant_id. */
  pinnedVariantId?: string | null
  /** Dominio público de la storefront (ej. "pilarargentina.store").
   *  Si no se conoce, se resuelve vía /shop.json (1 request, ~150ms). */
  storefrontDomain?: string | null
  /** Config de checkout por-workspace. Si null o sin offers => AUTO MODE. */
  config?: CheckoutConfig | null
  /** Divisa canónica del workspace ya resuelta por el runner. Fallback antes
   *  de caer a la divisa de /shop.json cuando la config no fija una. */
  currency?: string | null
  /** Chat web: id del visitante, para estampar el carrito y poder atribuir la
   *  venta a la conversación. Vacío en el resto de canales. */
  visitorId?: string | null
}

export interface CreateCheckoutResult {
  checkout_url: string
  offer_label: string
  total_label: string
  payment_label: string
  next_step_for_pili: string
}

/**
 * Formato de moneda. Para ARS reproducimos EXACTAMENTE el viejo `fmtArs`
 * ("$" + miles con punto, sin decimales) para no romper el output de
 * Pilar. Para el resto de monedas usamos Intl.NumberFormat con el código
 * ISO. Default 'ARS' para mantener el comportamiento histórico.
 */
export function fmtMoney(n: number, currency?: string | null): string {
  const cur = (currency || 'ARS').toUpperCase()
  if (cur === 'ARS') {
    // 69900 → "$69.900" (separador de miles con punto, como en AR).
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    // Currency desconocido por Intl → fallback simple con el código.
    return `${cur} ${n}`
  }
}

/**
 * Back-compat: `fmtArs` delega en `fmtMoney(..., 'ARS')`. Se mantiene por
 * si algún importador externo lo usa. Output idéntico al original.
 */
export function fmtArs(n: number): string {
  return fmtMoney(n, 'ARS')
}

/**
 * Resuelve el dominio público de la storefront y, opcionalmente, la
 * moneda de la tienda. Shopify expone ambos en
 * `/admin/api/{v}/shop.json` (`shop.domain` = primary domain del tema
 * activo; `shop.currency` = ISO 4217). Si la llamada falla, caemos al
 * myshopify.com y a 'USD'.
 */
async function resolveStorefront(
  ctx: CreateCheckoutContext,
): Promise<{ domain: string; currency: string }> {
  let cachedDomain: string | null = null
  if (ctx.storefrontDomain && ctx.storefrontDomain.trim()) {
    cachedDomain = ctx.storefrontDomain
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
  }
  try {
    const url = `https://${ctx.shopDomain}/admin/api/${ctx.apiVersion}/shop.json`
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': ctx.accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      return { domain: cachedDomain || ctx.shopDomain, currency: 'USD' }
    }
    const data = (await res.json()) as {
      shop?: { domain?: string; currency?: string }
    }
    return {
      domain: cachedDomain || data.shop?.domain || ctx.shopDomain,
      currency: data.shop?.currency || 'USD',
    }
  } catch {
    return { domain: cachedDomain || ctx.shopDomain, currency: 'USD' }
  }
}

/**
 * Punto de entrada. Construye el link de cart-permalink y devuelve un
 * objeto compacto que el modelo va a parafrasear para la clienta.
 */
/**
 * Los `attributes[...]` que viajan pegados al carrito y llegan al pedido.
 *
 * Vive aparte porque hay dos caminos que arman un enlace —el de un producto y
 * el de varios— y la marca de origen y el id del visitante tienen que ir en los
 * dos: sin ellos la venta llega al comercio sin saber de dónde salió.
 */
function attributesQuery(
  ctx: CreateCheckoutContext,
  hasTransferDiscount: boolean,
  transferLabel: string | null,
  transferAmount: number | null,
  discountCode?: string | null,
): string {
  const params = new URLSearchParams()
  // `discount` es un parámetro propio de Shopify, no un atributo: aplica el
  // cupón al entrar, sin que nadie tenga que tipearlo.
  const cupon = (discountCode ?? '').trim()
  if (/^[A-Za-z0-9_-]{3,40}$/.test(cupon)) params.set('discount', cupon)
  // Marca de origen: la orden resultante lleva este note_attribute para que el
  // webhook orders/create sepa que vino de un link del asistente.
  params.set('attributes[riverz_origin]', 'ai')
  // Chat web: el id del visitante viaja con el carrito hasta el pedido, que es
  // lo que después permite decir "esta venta salió de esta conversación". Hace
  // falta acá aunque el widget ya estampe el carrito, porque un enlace de
  // carrito REEMPLAZA el carrito: lo estampado antes se pierde justo cuando la
  // persona decide comprar.
  if (ctx.visitorId) params.set('attributes[riverz_wvid]', ctx.visitorId)
  if (hasTransferDiscount && transferLabel && transferAmount != null) {
    params.set('attributes[pago]', transferLabel)
    params.set('attributes[descuento_pendiente_ars]', String(transferAmount))
  }
  return params.toString()
}

/** Cómo se le cuenta a la clienta con qué puede pagar. */
function pagoLabel(hint: PaymentHint, config: CheckoutConfig | null): string {
  const methods = config?.payment_methods ?? null
  const card = !methods || methods.includes('card')
  const mp = !methods || methods.includes('mercado_pago')
  if (hint === 'transfer') return 'Puedes pagar por transferencia; te pasamos los datos.'
  return card && mp
    ? 'Puedes pagar con tarjeta (hasta 3 cuotas sin interés) o Mercado Pago en el checkout.'
    : 'Puedes completar el pago en el checkout de la tienda.'
}

export async function createCheckoutLink(
  input: CreateCheckoutInput,
  ctx: CreateCheckoutContext,
): Promise<CreateCheckoutResult | { error: string; message: string }> {
  const config = ctx.config ?? null
  const offers = config?.offers ?? null
  const bundleMode = !!(config?.enabled && offers && offers.length > 0)

  // ── Varios productos: gana sobre todo lo demás ────────────────────
  //
  // Cuando el modelo nombra productos concretos, eso es lo que la clienta
  // pidió — no una oferta preconfigurada ni el producto por defecto. Va
  // primero y con su propio camino: no hay stock que chequear contra un solo
  // variant ni un precio que cotizar, porque el total lo arma el checkout.
  const lineas = (input.items ?? [])
    .map((i) => ({
      variant_id: String(i.variant_id ?? '').trim(),
      quantity: Math.max(1, Math.floor(Number(i.quantity ?? 1)) || 1),
    }))
    .filter((i) => /^\d+$/.test(i.variant_id))
  if (lineas.length > 0) {
    const { domain: storefront } = await resolveStorefront(ctx)
    // El descuento por transferencia también acá.
    //
    // Iba fijo en `false`, así que el carrito de dos productos llegaba sin la
    // marca que el equipo mira para aplicarlo — mientras `pagoLabel`, abajo,
    // seguía diciéndole a la clienta que podía pagar por transferencia. La
    // misma persona, pagando igual, tenía el descuento con un producto y no con
    // dos: o se pierde la venta o alguien lo compensa a mano.
    const montoTransferencia =
      typeof config?.transfer_discount_amount === 'number'
        ? config.transfer_discount_amount
        : null
    const etiquetaTransferencia = config?.transfer_discount_label || 'transferencia'
    const conTransferencia =
      input.payment_hint === 'transfer' && montoTransferencia != null && montoTransferencia > 0
    const qs = attributesQuery(
      ctx,
      conTransferencia,
      etiquetaTransferencia,
      montoTransferencia,
      input.discount_code,
    )
    const path = lineas.map((l) => `${l.variant_id}:${l.quantity}`).join(',')
    const unidades = lineas.reduce((n, l) => n + l.quantity, 0)
    return {
      checkout_url: `https://${storefront}/cart/${path}${qs ? '?' + qs : ''}`,
      offer_label:
        lineas.length === 1
          ? `${unidades} unidad(es)`
          : `${lineas.length} productos (${unidades} unidades)`,
      // El total no se cotiza acá a propósito: con varias líneas habría que
      // pedir el precio de cada variant, y decir un número que después no
      // coincide con el checkout es peor que no decir ninguno.
      total_label: '',
      payment_label: pagoLabel(input.payment_hint ?? 'card_or_mp', config),
      next_step_for_pili:
        'Pásale el link y dile que ahí ve el total con todo junto. No inventes el precio total.',
    }
  }

  // ── Resolución de oferta / cantidad ───────────────────────────────
  let qty: number
  let offerLabel: string
  let matchedOffer: CheckoutOfferConfig | null = null
  if (bundleMode) {
    const key = input.offer
    matchedOffer = (offers ?? []).find((o) => o.key === key) ?? null
    if (!matchedOffer) {
      const valid = (offers ?? []).map((o) => o.key).join(' | ')
      return {
        error: 'invalid_offer',
        message: `Oferta "${key ?? ''}" no reconocida. Usa ${valid}.`,
      }
    }
    qty = matchedOffer.qty
    offerLabel = matchedOffer.label
  } else {
    qty = input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : 1
    offerLabel = qty === 1 ? '1 unidad' : `${qty} unidades`
  }

  // ── Resolución del variant ────────────────────────────────────────
  const variantId =
    (ctx.pinnedVariantId && ctx.pinnedVariantId.trim()) ||
    (config?.default_variant_id && config.default_variant_id.trim()) ||
    null
  if (!variantId) {
    return {
      error: 'no_variant',
      message:
        'No pude resolver el producto de esta tienda. Pide ayuda al equipo humano para armar el link.',
    }
  }

  // Best-effort stock check + (AUTO MODE) precio real del variant antes
  // de entregar el link. El check de stock sólo bloquea cuando la tienda
  // trackea inventario Y deniega oversell — para variants sin tracking
  // (inventory_management=null) o "continue selling" caemos al link como
  // antes. Fail-open en errores de red/Admin para no romper el happy path.
  let autoUnitPrice: number | null = null
  try {
    const fields = bundleMode
      ? 'inventory_quantity,inventory_policy,inventory_management'
      : 'inventory_quantity,inventory_policy,inventory_management,price'
    const vUrl = `https://${ctx.shopDomain}/admin/api/${ctx.apiVersion}/variants/${variantId}.json?fields=${fields}`
    const vRes = await fetch(vUrl, {
      headers: {
        'X-Shopify-Access-Token': ctx.accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (vRes.ok) {
      const { variant } = (await vRes.json()) as {
        variant?: {
          inventory_quantity?: number
          inventory_policy?: string
          inventory_management?: string | null
          price?: string | number
        }
      }
      if (
        variant?.inventory_management &&
        variant.inventory_policy === 'deny' &&
        typeof variant.inventory_quantity === 'number' &&
        variant.inventory_quantity < qty
      ) {
        return {
          error: 'out_of_stock',
          message: `No hay stock suficiente para ${offerLabel} ahora mismo (quedan ${variant.inventory_quantity}). Ofrécele anotarse en lista de espera o sugiere otra cantidad.`,
        }
      }
      if (!bundleMode && variant?.price != null) {
        const p =
          typeof variant.price === 'number'
            ? variant.price
            : parseFloat(variant.price)
        if (!Number.isNaN(p)) autoUnitPrice = p
      }
    }
  } catch {
    /* fail-open */
  }

  const { domain: storefront, currency: shopCurrency } =
    await resolveStorefront(ctx)
  const currency = config?.currency || ctx.currency || shopCurrency
  const paymentHint: PaymentHint = input.payment_hint ?? 'card_or_mp'

  // ── Descuento por transferencia (sólo si la config lo provee) ──────
  const transferAmount =
    typeof config?.transfer_discount_amount === 'number'
      ? config.transfer_discount_amount
      : null
  const transferLabel = config?.transfer_discount_label || 'transferencia'
  const hasTransferDiscount =
    paymentHint === 'transfer' && transferAmount != null && transferAmount > 0

  // Cart-permalink format:
  //   https://{storefront}/cart/{variant_id}:{quantity}?attributes[...]=...
  // Cuando paga por transferencia y hay descuento configurado, sumamos
  // cart-attributes para que el backoffice vea el flag y aplique el
  // descuento al confirmar.
  const qs = attributesQuery(
    ctx,
    hasTransferDiscount,
    transferLabel,
    transferAmount,
    input.discount_code,
  )
  const checkoutUrl = `https://${storefront}/cart/${variantId}:${qty}${qs ? '?' + qs : ''}`

  // ── Etiquetas para el modelo ──────────────────────────────────────
  let totalLabel: string
  if (bundleMode) {
    const total = matchedOffer!.total
    const compare = matchedOffer!.compare_at
    // No pre-restamos el descuento por transferencia del total que ve la
    // clienta: el checkout de Shopify muestra el total completo, y si
    // cotizamos un número menor la clienta cree que la IA mintió (o que
    // el bundle se rompió). Mostramos el mismo total que Shopify y
    // encuadramos el descuento como crédito post-confirmación.
    const base =
      compare != null
        ? `${fmtMoney(total, currency)} (antes ${fmtMoney(compare, currency)})`
        : `${fmtMoney(total, currency)}`
    totalLabel = hasTransferDiscount
      ? `${base} — te devolvemos ${fmtMoney(transferAmount!, currency)} al confirmar la ${transferLabel}`
      : base
  } else {
    // AUTO MODE: precio real × cantidad. Sin compare-at, sin descuento
    // inventado. Si no pudimos leer el precio, devolvemos un total sin
    // monto (el modelo cotiza el precio listado que ya conoce).
    if (autoUnitPrice != null) {
      const total = autoUnitPrice * qty
      const base = fmtMoney(total, currency)
      totalLabel = hasTransferDiscount
        ? `${base} — te devolvemos ${fmtMoney(transferAmount!, currency)} al confirmar la ${transferLabel}`
        : base
    } else {
      totalLabel = ''
    }
  }

  const paymentMethods = config?.payment_methods ?? null
  const acceptsCard = !paymentMethods || paymentMethods.includes('card')
  const acceptsMp = !paymentMethods || paymentMethods.includes('mercado_pago')

  const paymentLabel = hasTransferDiscount
    ? `En el checkout vas a ver el total completo; cuando confirmes la ${transferLabel} te devolvemos ${fmtMoney(transferAmount!, currency)}.`
    : acceptsCard && acceptsMp
      ? 'Puedes pagar con tarjeta (hasta 3 cuotas sin interés) o Mercado Pago en el checkout.'
      : 'Puedes completar el pago en el checkout de Shopify.'

  const nextStepForPili = hasTransferDiscount
    ? `Mándale el link. El total en Shopify es el total completo; cuando confirme la ${transferLabel} el equipo le devuelve ${fmtMoney(transferAmount!, currency)}.`
    : bundleMode
      ? 'Mándale el link y dile que en el checkout completa dirección y elige tarjeta o Mercado Pago. El descuento del bundle ya se aplica automático.'
      : 'Mándale el link y dile que en el checkout completa dirección y método de pago.'

  return {
    checkout_url: checkoutUrl,
    offer_label: offerLabel,
    total_label: totalLabel,
    payment_label: paymentLabel,
    next_step_for_pili: nextStepForPili,
  }
}
