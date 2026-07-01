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
export async function createCheckoutLink(
  input: CreateCheckoutInput,
  ctx: CreateCheckoutContext,
): Promise<CreateCheckoutResult | { error: string; message: string }> {
  const config = ctx.config ?? null
  const offers = config?.offers ?? null
  const bundleMode = !!(config?.enabled && offers && offers.length > 0)

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
        message: `Oferta "${key ?? ''}" no reconocida. Usá ${valid}.`,
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
        'No pude resolver el producto de esta tienda. Pedí ayuda al equipo humano para armar el link.',
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
          message: `No hay stock suficiente para ${offerLabel} ahora mismo (quedan ${variant.inventory_quantity}). Ofrecele anotarse en lista de espera o sugerí otra cantidad.`,
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
  const params = new URLSearchParams()
  // Marca de origen: la orden resultante lleva este note_attribute para que
  // el webhook orders/create sepa que vino de un link del asistente y haga
  // la confirmación por atribución (sin chocar con la automatización
  // "Nuevo pedido"). Ver src/app/api/shopify/webhooks/orders/route.ts.
  params.set('attributes[riverz_origin]', 'ai')
  if (hasTransferDiscount) {
    params.set('attributes[pago]', transferLabel)
    params.set('attributes[descuento_pendiente_ars]', String(transferAmount))
  }
  const qs = params.toString()
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
      ? 'Podés pagar con tarjeta (hasta 3 cuotas sin interés) o Mercado Pago en el checkout.'
      : 'Podés completar el pago en el checkout de Shopify.'

  const nextStepForPili = hasTransferDiscount
    ? `Mandale el link. El total en Shopify es el total completo; cuando confirme la ${transferLabel} el equipo le devuelve ${fmtMoney(transferAmount!, currency)}.`
    : bundleMode
      ? 'Mandale el link y decile que en el checkout completa dirección y elige tarjeta o Mercado Pago. El descuento del bundle ya se aplica automático.'
      : 'Mandale el link y decile que en el checkout completa dirección y método de pago.'

  return {
    checkout_url: checkoutUrl,
    offer_label: offerLabel,
    total_label: totalLabel,
    payment_label: paymentLabel,
    next_step_for_pili: nextStepForPili,
  }
}
