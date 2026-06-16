/**
 * Helper para la tool `create_checkout` del asistente IA.
 *
 * Devuelve un link de Shopify cart-permalink (`/cart/{variant_id}:{qty}`)
 * que dispara automáticamente cualquier descuento por bundle que la
 * tienda tenga configurado vía Shopify Functions (en particular Käching
 * Bundles, que es la app que Pilar Argentina usa para el "2+1 GRATIS" /
 * "3+1 GRATIS" del Sérum Pilar).
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
 * Para el descuento de $4.900 por transferencia: NO hay código en
 * Shopify (el equipo lo aplica manualmente al confirmar la transferencia
 * bancaria), así que mandamos cart-attributes que avisan al backoffice +
 * la respuesta para Pili explica el flujo.
 */

const PILAR_SHOP_DOMAINS = new Set(['j9kgap-kn.myshopify.com'])

export type CheckoutOffer = '1u' | '2u_1_gratis' | '3u_1_gratis'
export type PaymentHint = 'card_or_mp' | 'transfer'

/** Cantidad real que va al cart según la oferta elegida. */
const OFFER_QUANTITY: Record<CheckoutOffer, number> = {
  '1u': 1,
  '2u_1_gratis': 3,
  '3u_1_gratis': 4,
}

/** Etiqueta amigable para devolverle al modelo. */
const OFFER_LABEL: Record<CheckoutOffer, string> = {
  '1u': '1 unidad',
  '2u_1_gratis': '2 unidades + 1 gratis',
  '3u_1_gratis': '3 unidades + 1 gratis',
}

/** Precio final ARS por oferta — sólo para el `total_label` que devuelve
 *  la tool (no se usa en la URL: lo aplica la Cart Function). Estos
 *  valores son los verificados en la recon contra pilarargentina.store. */
const OFFER_TOTAL_ARS: Record<CheckoutOffer, number> = {
  '1u': 39990,
  '2u_1_gratis': 69900,
  '3u_1_gratis': 99900,
}

/** Precio "tachado" (compare_at) por oferta para mostrar el ahorro. */
const OFFER_COMPARE_ARS: Record<CheckoutOffer, number> = {
  '1u': 70000,
  '2u_1_gratis': 210000,
  '3u_1_gratis': 280000,
}

export interface CreateCheckoutInput {
  offer: CheckoutOffer
  payment_hint?: PaymentHint
}

export interface CreateCheckoutContext {
  /** Dominio admin (*.myshopify.com) del workspace. */
  shopDomain: string
  /** Access token Shopify Admin. Sólo se usa para resolver el dominio
   *  público de la storefront vía /shop.json si no lo tenemos cacheado. */
  accessToken: string
  apiVersion: string
  /** Variant id del producto que el cliente está mencionando — viene
   *  del productMatch en el runner. Si null, caemos a un default conocido
   *  (Pilar Sérum) para no romper la oferta principal. */
  pinnedVariantId?: string | null
  /** Dominio público de la storefront (ej. "pilarargentina.store").
   *  Si no se conoce, se resuelve vía /shop.json (1 request, ~150ms). */
  storefrontDomain?: string | null
}

export interface CreateCheckoutResult {
  checkout_url: string
  offer_label: string
  total_label: string
  payment_label: string
  next_step_for_pili: string
}

/**
 * Resuelve el dominio público de la storefront. Shopify lo expone en
 * `/admin/api/{v}/shop.json` como `shop.domain` (el primary domain del
 * tema activo). Si la llamada falla, caemos al myshopify.com — sigue
 * funcionando aunque sea menos "marca".
 */
async function resolveStorefrontDomain(
  ctx: CreateCheckoutContext,
): Promise<string> {
  if (ctx.storefrontDomain && ctx.storefrontDomain.trim()) {
    return ctx.storefrontDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
  try {
    const url = `https://${ctx.shopDomain}/admin/api/${ctx.apiVersion}/shop.json`
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': ctx.accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return ctx.shopDomain
    const data = (await res.json()) as { shop?: { domain?: string } }
    return data.shop?.domain || ctx.shopDomain
  } catch {
    return ctx.shopDomain
  }
}

/**
 * Resuelve el variant_id a usar:
 *   1. Si el caller pasó pinnedVariantId (producto detectado en el
 *      mensaje), ese tiene prioridad.
 *   2. Si la tienda es Pilar (conocida), usamos el variant del Sérum
 *      verificado en la recon. Esto evita devolver "no encontré producto"
 *      si el cliente ya está pidiendo claro pero el detector no marcó.
 *   3. Sino devolvemos null — la tool va a responder con un error
 *      controlado que el modelo puede parafrasear.
 */
function resolveVariantId(ctx: CreateCheckoutContext): string | null {
  if (ctx.pinnedVariantId && ctx.pinnedVariantId.trim()) {
    return ctx.pinnedVariantId.trim()
  }
  if (PILAR_SHOP_DOMAINS.has(ctx.shopDomain)) {
    return '48310065791076'
  }
  return null
}

function fmtArs(n: number): string {
  // 69900 → "$69.900" (separador de miles con punto, como en AR).
  return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * Punto de entrada. Construye el link de cart-permalink y devuelve un
 * objeto compacto que el modelo va a parafrasear para la clienta.
 */
export async function createCheckoutLink(
  input: CreateCheckoutInput,
  ctx: CreateCheckoutContext,
): Promise<CreateCheckoutResult | { error: string; message: string }> {
  const offer = input.offer
  if (!OFFER_QUANTITY[offer]) {
    return {
      error: 'invalid_offer',
      message: `Oferta "${offer}" no reconocida. Usá 1u | 2u_1_gratis | 3u_1_gratis.`,
    }
  }
  const variantId = resolveVariantId(ctx)
  if (!variantId) {
    return {
      error: 'no_variant',
      message:
        'No pude resolver el producto de esta tienda. Pedí ayuda al equipo humano para armar el link.',
    }
  }
  const qty = OFFER_QUANTITY[offer]

  // Best-effort stock check before we hand out the link. Only blocks
  // when the shop both tracks inventory AND denies oversell — for
  // untracked variants (inventory_management=null) or "continue
  // selling" variants we fall through to the link as before. Fail-open
  // on network/Admin errors so we never silently break the happy path.
  try {
    const vUrl = `https://${ctx.shopDomain}/admin/api/${ctx.apiVersion}/variants/${variantId}.json?fields=inventory_quantity,inventory_policy,inventory_management`
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
          message: `No hay stock suficiente para ${OFFER_LABEL[offer]} ahora mismo (quedan ${variant.inventory_quantity}). Ofrecele anotarse en lista de espera o sugerí otra cantidad.`,
        }
      }
    }
  } catch {
    /* fail-open */
  }

  const storefront = await resolveStorefrontDomain(ctx)
  const paymentHint: PaymentHint = input.payment_hint ?? 'card_or_mp'

  // Cart-permalink format:
  //   https://{storefront}/cart/{variant_id}:{quantity}?attributes[...]=...
  // Cuando paga por transferencia, sumamos cart-attributes para que el
  // backoffice vea el flag y aplique los $4.900 menos al confirmar.
  const params = new URLSearchParams()
  if (paymentHint === 'transfer') {
    params.set('attributes[pago]', 'transferencia')
    params.set('attributes[descuento_pendiente_ars]', '4900')
  }
  const qs = params.toString()
  const checkoutUrl = `https://${storefront}/cart/${variantId}:${qty}${qs ? '?' + qs : ''}`

  const total = OFFER_TOTAL_ARS[offer]
  const compare = OFFER_COMPARE_ARS[offer]
  // We don't pre-subtract the $4,900 transfer discount from the
  // customer-facing total any more: Shopify's checkout will show the
  // full total, and if we quote a number that's $4,900 lower the
  // customer thinks the AI lied (or the bundle promo broke). Instead we
  // show the same total Shopify will show and frame the $4,900 as a
  // post-confirmation credit.
  const totalLabel =
    paymentHint === 'transfer'
      ? `${fmtArs(total)} (antes ${fmtArs(compare)}) — te devolvemos $4.900 al confirmar la transferencia`
      : `${fmtArs(total)} (antes ${fmtArs(compare)})`

  const paymentLabel =
    paymentHint === 'transfer'
      ? 'En el checkout vas a ver el total completo; cuando confirmes la transferencia te devolvemos $4.900.'
      : 'Podés pagar con tarjeta (hasta 3 cuotas sin interés) o Mercado Pago en el checkout.'

  const nextStepForPili =
    paymentHint === 'transfer'
      ? 'Mandale el link. El total en Shopify es el total completo; cuando confirme la transferencia el equipo le devuelve $4.900.'
      : 'Mandale el link y decile que en el checkout completa dirección y elige tarjeta o Mercado Pago. El descuento del bundle ya se aplica automático.'

  return {
    checkout_url: checkoutUrl,
    offer_label: OFFER_LABEL[offer],
    total_label: totalLabel,
    payment_label: paymentLabel,
    next_step_for_pili: nextStepForPili,
  }
}
