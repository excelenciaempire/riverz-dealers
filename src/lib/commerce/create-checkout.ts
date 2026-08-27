/**
 * El link de compra en las tiendas que NO son Shopify.
 *
 * Hasta acá, un comercio de Tiendanube o de WooCommerce tenía un agente que
 * conversaba, recomendaba y consultaba pedidos — y no podía vender. Llegaba a
 * "te paso el link" y ahí se terminaba, porque `create_checkout` estaba atado a
 * Shopify. No es un detalle de una plataforma: es un comercio entero sin poder
 * cerrar una venta por el chat.
 *
 * **Las tres plataformas cargan el carrito de tres formas distintas**, medidas
 * el 2026-08-26 contra tiendas reales, no leídas de un blog:
 *
 *   - Shopify: `/cart/<variante>:<cantidad>` — un GET que carga el carrito. Se
 *     puede mandar por WhatsApp y funciona.
 *   - WooCommerce: `/checkout/?add-to-cart=<id>&quantity=<n>` — también GET,
 *     también compartible. Para un producto con variantes el id es el de la
 *     VARIACIÓN, no el del padre.
 *   - Tiendanube: **no hay link que cargue el carrito**. Su formulario hace
 *     `POST /comprar/` con `add_to_cart` y `quantity`; el mismo pedido por GET
 *     devuelve el carrito vacío (probado: total $0). Así que el link que se
 *     manda es el del PRODUCTO, que es lo que de verdad funciona en cualquier
 *     lado, y el carrito se carga desde el chat cuando hay chat.
 *
 * De ahí la forma de la respuesta: una `url` que sirve siempre —incluso pegada
 * en WhatsApp— y un `carrito` que describe qué agregar. El chat web usa el
 * segundo para cargar el carrito sin sacar a nadie de la conversación; los
 * demás canales usan la primera y listo.
 */

/** Qué agregar al carrito, para quien pueda hacerlo desde la misma página. */
export interface DescriptorDeCarrito {
  plataforma: 'tiendanube' | 'woocommerce'
  /** El id que espera la tienda: producto en Tiendanube, variación en Woo. */
  id: string
  cantidad: number
}

export interface LinkDeCompra {
  /** Para mandar. Funciona en cualquier canal, aunque no cargue el carrito. */
  url: string
  /** Para cargar el carrito desde la propia tienda. Null si no se puede. */
  carrito: DescriptorDeCarrito | null
  /** Si `url` YA deja el carrito cargado al abrirla. */
  cargaSola: boolean
}

export interface TiendaParaLink {
  platform: string
  shopDomain: string
  storeUrl?: string | null
}

/** El dominio público, que es el que ve el cliente. */
function base(tienda: TiendaParaLink): string {
  const crudo = (tienda.storeUrl || tienda.shopDomain || '').trim()
  if (!crudo) return ''
  const conEsquema = /^https?:\/\//i.test(crudo) ? crudo : `https://${crudo}`
  return conEsquema.replace(/\/+$/, '')
}

/**
 * La marca que le dice al chat "esto es un carrito, no un link cualquiera".
 *
 * Va en la query del link del producto porque tiene que sobrevivir a un copiar
 * y pegar por WhatsApp sin romper nada: la tienda ignora un parámetro que no
 * conoce y muestra el producto igual.
 */
export const MARCA_CARRITO = 'riverz_cart'

export function marcarLink(url: string, c: DescriptorDeCarrito): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}${MARCA_CARRITO}=${c.plataforma === 'tiendanube' ? 'tn' : 'wc'}:${c.id}:${c.cantidad}`
}

/** Lee la marca. Devuelve null si el link no la trae. */
export function leerMarca(url: string): DescriptorDeCarrito | null {
  const m = new RegExp(`[?&]${MARCA_CARRITO}=(tn|wc):(\\d+):(\\d+)`).exec(url)
  if (!m) return null
  return {
    plataforma: m[1] === 'tn' ? 'tiendanube' : 'woocommerce',
    id: m[2],
    cantidad: Number(m[3]) || 1,
  }
}

/**
 * El link para comprar un producto, en la tienda que sea.
 *
 * `productUrl` es la ficha pública del producto —la que Riverz ya guarda al
 * sincronizar—. Hace falta para Tiendanube, donde es lo único que se puede
 * mandar; en Woo se usa el checkout directo, que es mejor.
 */
export function armarLinkDeCompra(args: {
  tienda: TiendaParaLink
  /** Producto en Tiendanube, VARIACIÓN en WooCommerce. */
  id: string
  cantidad?: number
  productUrl?: string | null
}): LinkDeCompra | null {
  const raiz = base(args.tienda)
  const id = String(args.id ?? '').trim()
  if (!raiz || !id) return null
  const cantidad = Math.max(1, Math.floor(Number(args.cantidad) || 1))
  const plataforma = (args.tienda.platform || '').toLowerCase()

  if (plataforma === 'woocommerce') {
    // Directo al checkout: quien ya dijo que lo quiere no necesita pasar por
    // el carrito para volver a decirlo.
    return {
      url: `${raiz}/checkout/?add-to-cart=${encodeURIComponent(id)}&quantity=${cantidad}`,
      carrito: { plataforma: 'woocommerce', id, cantidad },
      cargaSola: true,
    }
  }

  if (plataforma === 'tiendanube') {
    const ficha = (args.productUrl || '').trim() || `${raiz}/productos/`
    return {
      url: marcarLink(ficha, { plataforma: 'tiendanube', id, cantidad }),
      carrito: { plataforma: 'tiendanube', id, cantidad },
      // El link abre la ficha del producto, no el carrito cargado. Decirlo
      // acá evita que el agente prometa "ya te lo dejé en el carrito".
      cargaSola: false,
    }
  }

  return null
}
