/**
 * Encontrar un pedido por su número, escriba quien lo escriba.
 *
 * Shopify guarda el número CON almohadilla (`#1001`) y Tiendanube sin ella
 * (`111`). Las herramientas de postventa la sacaban antes de comparar, así que
 * en Shopify la búsqueda nunca podía coincidir: el agente creaba el pedido
 * `#1001` y a los dos minutos contestaba "no encontré el pedido 1001 a nombre de
 * esta persona" — sobre un pedido que acababa de crear él.
 *
 * Medido el 2026-08-24 contra riverz-demo.myshopify.com: pasaba en las tres,
 * editar, cancelar y reembolsar.
 *
 * Se comparan las DOS formas en vez de normalizar al guardar: la columna ya
 * tiene años de pedidos escritos de las dos maneras, y una migración que los
 * reescriba tocaría el número que el comercio ve en su tienda.
 */

/** Las formas en que ese número puede estar guardado. */
export function formasDelNumero(entrada: string): string[] {
  const limpio = (entrada ?? '').trim()
  if (!limpio) return []
  const sinAlmohadilla = limpio.replace(/^#/, '')
  if (!sinAlmohadilla) return []
  return Array.from(new Set([sinAlmohadilla, `#${sinAlmohadilla}`]))
}

/**
 * El número como se le muestra a una persona: con UNA almohadilla.
 *
 * Los títulos de aprobación la ponían a mano sobre el número guardado, así que
 * en Shopify salía «¿Reembolsar el pedido ##1002?».
 */
export function conAlmohadilla(entrada: unknown): string {
  const limpio = String(entrada ?? '').trim().replace(/^#+/, '')
  return limpio ? `#${limpio}` : ''
}

/**
 * El filtro de PostgREST para "el número, con o sin almohadilla".
 *
 * El valor va entre comillas porque `or()` usa la coma de separador y el punto
 * de operador: un número con cualquiera de las dos partiría la condición en
 * filtros inventados. Se sacan antes las comillas y las barras, que son lo único
 * que podría cerrar la comilla de más.
 */
export function filtroDeNumero(entrada: string): string | null {
  const formas = formasDelNumero(entrada)
  if (formas.length === 0) return null
  return formas
    .map((f) => `order_number.eq."${f.replace(/["\\]/g, '')}"`)
    .join(',')
}
