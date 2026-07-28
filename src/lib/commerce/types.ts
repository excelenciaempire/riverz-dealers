/**
 * Tipos normalizados de tienda (Shopify / Tiendanube / WooCommerce).
 *
 * Todo lo que Riverz hace con una tienda —alimentar el catálogo del
 * agente, recuperar carritos, espejar pedidos, marcar compradores— se
 * expresa acá en una sola forma. Cada plataforma tiene su adaptador que
 * traduce SU payload a estos tipos; de ahí para adentro el resto del
 * producto no sabe (ni necesita saber) dónde vive la tienda.
 *
 * Regla: los adaptadores normalizan, no interpretan. Cualquier decisión
 * de negocio (cuándo un carrito está abandonado, qué automatización
 * dispara un pedido) vive en la capa de ingesta, una sola vez.
 */

export type CommercePlatform = 'shopify' | 'tiendanube' | 'woocommerce'

export const COMMERCE_PLATFORMS: CommercePlatform[] = [
  'shopify',
  'tiendanube',
  'woocommerce',
]

/** Cómo se autenticó la conexión. 'api_key' = par clave/secreto (WooCommerce). */
export type ConnectionMethod = 'oauth' | 'admin_token' | 'api_key'

export type ConnectionStatus = 'active' | 'uninstalled' | 'expired' | 'error'

/**
 * Credenciales resueltas de una tienda conectada, ya descifradas.
 * `accessToken` guarda el token OAuth (Shopify/Tiendanube) o el
 * consumer_key (WooCommerce); `apiSecret` solo lo usa WooCommerce.
 */
export interface StoreCredentials {
  id: string
  platform: CommercePlatform
  workspaceId: string
  userId: string
  /** Clave de tienda: host myshopify / mitiendanube / del sitio WordPress. */
  shopDomain: string
  shopName: string | null
  /** Id del lado de la plataforma. Obligatorio en Tiendanube. */
  externalStoreId: string | null
  /** URL pública de la tienda, para armar links de producto. */
  storeUrl: string | null
  accessToken: string
  apiSecret: string | null
  currency: string | null
  scope: string | null
  status: ConnectionStatus
  connectionMethod: ConnectionMethod
}

/** Un producto del catálogo, tal como lo consume el agente. */
export interface NormalizedProduct {
  externalId: number
  handle: string
  title: string
  description: string
  productType: string | null
  vendor: string | null
  tags: string[]
  priceMin: number | null
  priceMax: number | null
  imageUrl: string | null
  url: string | null
  /** Payload crudo de la plataforma, para depurar y para el detector de bundles. */
  raw: Record<string, unknown>
}

/** Un ítem de pedido o carrito. */
export interface NormalizedLineItem {
  title: string | null
  quantity: number | null
  price: string | null
  variantId: string | number | null
  productId: string | number | null
  imageUrl: string | null
}

/** Datos de contacto del comprador, ya extraídos del payload. */
export interface NormalizedCustomer {
  name: string | null
  email: string | null
  /** Teléfono CRUDO: la normalización a E.164 la hace la capa de ingesta. */
  phone: string | null
  /** ISO-2 del país de compra, para poner el prefijo correcto al teléfono. */
  countryCode: string | null
  /** Cuántos pedidos lleva. 0 si la plataforma no lo informa. */
  ordersCount: number
}

/** Dirección de envío, para las variables de las automatizaciones. */
export interface NormalizedAddress {
  address: string
  city: string
  province: string
  zip: string
  country: string
}

/**
 * Estado de un pedido, normalizado a los tres ejes que Riverz usa para
 * decidir transiciones. Cada plataforma tiene su vocabulario propio
 * (Tiendanube separa payment_status/shipping_status, WooCommerce mete
 * todo en un solo `status`); el adaptador lo reduce a esto.
 */
export interface NormalizedOrderState {
  /** null | 'pending' | 'paid' | 'refunded' | 'voided' */
  financialStatus: string | null
  /** null | 'partial' | 'fulfilled' */
  fulfillmentStatus: string | null
  cancelled: boolean
  /** El envío figura como entregado al destinatario. */
  delivered: boolean
}

export interface NormalizedOrder {
  externalId: number
  /** Número visible para el cliente ("#1042"). */
  name: string
  orderNumber: string
  totalPrice: string
  subtotalPrice: string
  totalDiscounts: string
  currency: string
  lineItems: NormalizedLineItem[]
  customer: NormalizedCustomer
  shippingAddress: NormalizedAddress
  state: NormalizedOrderState
  /** URL de seguimiento del pedido para el cliente, si la plataforma la da. */
  orderStatusUrl: string
  trackingNumber: string
  trackingCompany: string
  trackingUrl: string
  /** Token del carrito que originó el pedido, para cerrarlo al comprar. */
  checkoutToken: string | null
  raw: Record<string, unknown>
}

export interface NormalizedCheckout {
  /** Id/token estable del carrito en la plataforma. */
  checkoutId: string
  customer: NormalizedCustomer
  totalPrice: number | null
  currency: string | null
  lineItems: NormalizedLineItem[]
  /** Link con el que el cliente retoma la compra. Sin esto no hay recuperación. */
  recoveryUrl: string | null
  completedAt: string | null
  createdAt: string | null
}

/** Errores de credencial, para poder marcar la conexión como expirada. */
export class StoreUnauthorizedError extends Error {
  status = 401
  constructor(
    public readonly platform: CommercePlatform,
    public readonly shopDomain: string,
    message: string,
  ) {
    super(message)
    this.name = 'StoreUnauthorizedError'
  }
}
