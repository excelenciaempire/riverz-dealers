import type { AutomationTriggerType } from '@/types'

/**
 * De qué tienda depende un activador, para que el lienzo lo muestre.
 *
 * Los activadores de tienda comparten el nombre histórico `shopify_*` para
 * las tres plataformas: un pedido de Tiendanube dispara el MISMO
 * `shopify_order_created` que uno de Shopify. Eso está bien en el motor
 * —una automatización sirve para cualquier tienda— pero la tarjeta pintaba
 * el logo de Shopify para todas, así que una automatización que sólo
 * dispara con Tiendanube se leía como si dependiera de una tienda que ni
 * siquiera está conectada.
 */

export const PLATFORM_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  tiendanube: 'Tiendanube',
  woocommerce: 'WooCommerce',
}

export const PLATFORM_ICON: Record<string, string> = {
  shopify: '/channels/shopify.svg',
  tiendanube: '/channels/tiendanube.svg',
  woocommerce: '/channels/woocommerce.svg',
}

export function esActivadorDeTienda(type: string): boolean {
  return type.startsWith('shopify_')
}

/**
 * La tienda que dispara ESTE activador, o null si no hay una sola respuesta.
 *
 * Es la elegida en el filtro cuando hay exactamente una; si no hay filtro, la
 * única conectada de la cuenta. Con varias conectadas y sin filtrar dispara
 * con todas, y ahí el lienzo muestra el icono genérico en vez de elegir una
 * al azar.
 */
export function triggerStorePlatform(
  type: AutomationTriggerType | string,
  config: Record<string, unknown> | null | undefined,
  storePlatforms: string[]
): string | null {
  if (!esActivadorDeTienda(String(type))) return null
  const elegidas = Array.isArray(
    (config as { platforms?: unknown } | null | undefined)?.platforms
  )
    ? ((config as { platforms?: string[] }).platforms as string[])
    : []
  if (elegidas.length === 1) return elegidas[0]
  if (elegidas.length === 0 && storePlatforms.length === 1)
    return storePlatforms[0]
  return null
}
