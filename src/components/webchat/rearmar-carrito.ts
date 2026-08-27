/**
 * Cambiar la variante o la cantidad sin volver a preguntarle al agente.
 *
 * La tarjeta mostraba lo que el modelo había elegido y nada más: quien quería
 * el mismo producto en otro talle, o dos en vez de uno, tenía que escribirlo y
 * esperar que el agente acertara y armara otro enlace. Dos turnos de chat para
 * mover un número.
 *
 * Acá el enlace se reescribe en el navegador. Es seguro porque el enlace ya
 * apunta a la tienda del comercio y lo único que cambia es QUÉ y CUÁNTO — el
 * precio lo sigue poniendo la tienda en su carrito, no esta pantalla.
 *
 * Cada plataforma escribe eso en un lugar distinto, así que hay tres formas.
 */

export interface CarritoDelEnlace {
  /** El enlace listo para mandar al cargador. */
  path: string
  /** El absoluto, para abrir en otra pestaña si el cargador no contesta. */
  href: string
}

const MARCA = /([?&]riverz_cart=)(tn|wc):(\d+):(\d+)/
const WOO = /([?&]add-to-cart=)(\d+)/
const SHOPIFY = /^(\/cart\/)(\d+):(\d+)(.*)$/

/**
 * Reescribe un enlace de compra con otra variante o cantidad.
 *
 * Devuelve `null` cuando el enlace trae VARIAS líneas: ahí cambiar "la"
 * cantidad no significa nada, y adivinar cuál mover es peor que no ofrecerlo.
 */
export function rearmar(
  href: string,
  cambio: { variantId?: string; cantidad?: number },
): CarritoDelEnlace | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const cantidad = Math.max(1, Math.floor(cambio.cantidad ?? 1))
  const entero = /^\d+$/.test(cambio.variantId ?? '')

  const completo = url.pathname + url.search
  const conMarca = MARCA.exec(completo)
  if (conMarca) {
    const id = entero ? cambio.variantId! : conMarca[3]
    const nuevo = completo.replace(MARCA, `$1${conMarca[2]}:${id}:${cantidad}`)
    return { path: nuevo, href: url.origin + nuevo }
  }

  const conWoo = WOO.exec(completo)
  if (conWoo) {
    const id = entero ? cambio.variantId! : conWoo[2]
    let nuevo = completo.replace(WOO, `$1${id}`)
    nuevo = /[?&]quantity=\d+/.test(nuevo)
      ? nuevo.replace(/([?&]quantity=)\d+/, `$1${cantidad}`)
      : `${nuevo}${nuevo.includes('?') ? '&' : '?'}quantity=${cantidad}`
    return { path: nuevo, href: url.origin + nuevo }
  }

  const conShopify = SHOPIFY.exec(url.pathname)
  if (conShopify) {
    // Varias líneas: `/cart/111:1,222:2`. No se toca.
    if (url.pathname.includes(',')) return null
    const id = entero ? cambio.variantId! : conShopify[2]
    const nuevo = `/cart/${id}:${cantidad}${url.search}`
    return { path: nuevo, href: url.origin + nuevo }
  }

  return null
}
