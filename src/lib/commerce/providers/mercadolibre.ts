import type { NormalizedProduct } from '../types'

/**
 * Mercado Libre como origen de catálogo.
 *
 * A diferencia de Shopify, Tiendanube y WooCommerce, Mercado Libre **no se
 * conecta como tienda**: ya está conectado como canal de mensajes, con el
 * mismo token. Por eso no hay OAuth ni cliente propio acá — sólo la
 * normalización, que es lo único que el catálogo común necesita.
 */

interface MlItem {
  id?: string
  title?: string
  permalink?: string
  price?: number
  base_price?: number
  original_price?: number | null
  currency_id?: string
  available_quantity?: number
  sold_quantity?: number
  status?: string
  condition?: string
  category_id?: string
  thumbnail?: string
  secure_thumbnail?: string
  pictures?: Array<{ secure_url?: string; url?: string }>
  attributes?: Array<{ id?: string; name?: string; value_name?: string | null }>
}

/**
 * Publicación de Mercado Libre → producto normalizado.
 *
 * Dos decisiones que no son obvias:
 *
 * - **La descripción se arma con los atributos**, no con el texto libre. En
 *   Mercado Libre la descripción larga vive en otro endpoint
 *   (`/items/{id}/description`) y suele ser marketing; lo que le sirve al
 *   agente para contestar es la ficha (marca, contenido, tipo de piel), que
 *   viene ya estructurada en `attributes`.
 * - **El stock entra en `tags`** como `stock:N`. El catálogo común no tiene
 *   columna de existencias, y sin el dato el agente ofrece lo agotado.
 */
export function normalizeMlItem(raw: unknown): NormalizedProduct | null {
  const it = raw as MlItem | null
  if (!it?.id || !it.title) return null

  const price =
    typeof it.price === 'number'
      ? it.price
      : typeof it.base_price === 'number'
        ? it.base_price
        : null

  const attrs = (it.attributes ?? [])
    .filter((a) => a?.name && a.value_name)
    .map((a) => `${a.name}: ${a.value_name}`)

  const image =
    it.pictures?.[0]?.secure_url ??
    it.pictures?.[0]?.url ??
    it.secure_thumbnail ??
    it.thumbnail ??
    null

  const stock = Number(it.available_quantity ?? 0)
  const tags = [
    'mercadolibre',
    `stock:${stock}`,
    it.condition ? `condicion:${it.condition}` : null,
    it.status ? `estado:${it.status}` : null,
  ].filter((t): t is string => !!t)

  return {
    // `externalId` es numérico en la interfaz común, pero los ids de Mercado
    // Libre son alfanuméricos ("MLA1303003750"). El id real se conserva en
    // `handle` y en `raw`; acá va la parte numérica sólo para cumplir el tipo.
    externalId: Number(String(it.id).replace(/\D/g, '')) || 0,
    handle: String(it.id),
    title: it.title,
    description: attrs.join('\n'),
    productType: null,
    vendor: null,
    tags,
    priceMin: price,
    priceMax: price,
    imageUrl: image,
    url: it.permalink ?? null,
    raw: (raw ?? {}) as Record<string, unknown>,
  }
}

/** ¿Se puede vender? Publicación activa y con existencias. */
export function mlItemIsSellable(raw: unknown): boolean {
  const it = raw as MlItem | null
  return it?.status === 'active' && Number(it.available_quantity ?? 0) > 0
}
