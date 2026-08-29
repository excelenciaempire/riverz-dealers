import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';
import { armarLinkDeCompra } from '@/lib/commerce/create-checkout';

/**
 * GET /api/widget/product?variant=<id>  ·  ?url=<ficha del producto>
 *
 * Los datos de un producto para dibujar una tarjeta: foto, título y precio.
 *
 * Dos formas de pedirlo porque el agente manda dos clases de enlace:
 *
 *   variant — el de carrito (`/cart/<variante>:<cantidad>`), donde lo único
 *             que viaja es el id de la variante.
 *   url     — la FICHA del producto, que es lo que manda cuando recomienda
 *             algo sin cerrar la venta ("el Serum Pilar sale $39.990,
 *             mirálo acá"). Hasta acá eso se veía como un enlace azul con
 *             sus UTM a la vista y sacaba a la persona del chat, que es
 *             exactamente lo que la tarjeta existe para evitar.
 *
 * Con `url` se devuelve además `cart_url`: el enlace de compra de esa ficha,
 * armado con la misma función que usa el agente. Así la tarjeta que sale de
 * una recomendación tiene los mismos dos botones que la que sale de un
 * carrito — agregar y ir a pagar— y no una versión pobre.
 *
 * El catálogo de un comercio es público (está en su tienda), pero igual va
 * detrás del token del chat y acotado a SU workspace: sirve de poco exponer un
 * endpoint por el que cualquiera enumere el catálogo de cualquier cuenta.
 */
export async function GET(request: Request) {
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const variant = params.get('variant')?.trim() ?? '';
  const fichaUrl = params.get('url')?.trim() ?? '';

  const db = supabaseAdmin();
  const columnas = 'title, image_url, url, handle, platform, price_min, currency, raw';
  let data: unknown = null;

  if (variant) {
    // Sólo dígitos: el valor entra en una consulta y sale de una URL que
    // escribió un modelo de lenguaje.
    if (!/^\d{1,20}$/.test(variant)) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    ({ data } = await db
      .from('shopify_products')
      .select(columnas)
      .eq('workspace_id', guard.session.workspaceId)
      // La variante vive dentro del volcado crudo de la tienda; `@>` usa el
      // índice GIN del jsonb en vez de recorrer el catálogo entero.
      .filter('raw->variants', 'cs', `[{"id":${variant}}]`)
      .limit(1)
      .maybeSingle());
  } else if (fichaUrl) {
    // De la ficha sólo importa el `handle`: el resto de la dirección cambia
    // con el idioma, los UTM y la barra final, y ninguna de esas variaciones
    // es otro producto.
    const handle = handleDeLaFicha(fichaUrl);
    if (!handle) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    ({ data } = await db
      .from('shopify_products')
      .select(columnas)
      .eq('workspace_id', guard.session.workspaceId)
      .eq('handle', handle)
      .limit(1)
      .maybeSingle());
  } else {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const row = data as {
    title: string | null;
    image_url: string | null;
    url: string | null;
    handle: string | null;
    platform: string | null;
    price_min: number | string | null;
    currency: string | null;
    raw: {
      images?: Array<{ src?: string }>;
      variants?: Array<{
        id?: number | string;
        price?: number | string | null;
        promotional_price?: number | string | null;
        title?: string | null;
        option1?: string | null;
        option2?: string | null;
        option3?: string | null;
        values?: Array<{ es?: string; en?: string; pt?: string } | string> | null;
        available?: boolean | null;
        stock?: number | null;
      }>;
    } | null;
  };

  // El precio de ESTA variante, no el mínimo del producto.
  //
  // Un serum de 50 ml a $20.000 y de 200 ml a $60.000 son el mismo producto:
  // devolviendo `price_min`, la tarjeta del de 200 ml decía $20.000 y en el
  // checkout aparecían $60.000. Mostrar un precio y cobrar otro es la peor
  // forma de perder una venta que ya estaba hecha.
  const variante = (row.raw?.variants ?? []).find((v) => String(v?.id ?? '') === variant);
  const precioVariante = variante?.promotional_price ?? variante?.price ?? null;
  const precio = precioVariante != null ? Number(precioVariante) : Number(row.price_min ?? NaN);

  // La variante que la tarjeta va a ofrecer cuando el pedido vino por ficha:
  // la primera disponible. Un producto sin variantes tiene una sola y es esa.
  const porDefecto =
    variante ??
    (row.raw?.variants ?? []).find((v) => v?.available !== false && v?.stock !== 0) ??
    (row.raw?.variants ?? [])[0] ??
    null;
  const idPorDefecto = String(porDefecto?.id ?? '');

  return NextResponse.json({
    title: row.title ?? '',
    // Con qué variante dibujarse y con qué enlace comprar. Sólo hace falta
    // cuando se pidió por ficha: pedido por variante, el chat ya los tiene.
    variant: idPorDefecto || null,
    cart_url: fichaUrl ? linkDeCompra(row, idPorDefecto) : null,
    // `image_url` está vacío en catálogos que se sincronizaron antes de que se
    // guardara; la foto igual está en el volcado crudo.
    image: row.image_url || row.raw?.images?.[0]?.src || null,
    url: row.url,
    price: Number.isFinite(precio) ? precio : null,
    currency: row.currency,
    // Las otras variantes, para poder cambiar de talle sin salir del chat.
    //
    // Sin esto, quien quería el mismo producto en otro color tenía que volver
    // a escribirlo y esperar que el agente acertara. La tarjeta mostraba UNA
    // variante —la que el modelo eligió— como si fuera todo el producto.
    variants: (row.raw?.variants ?? [])
      .map((v) => ({
        id: String(v?.id ?? ''),
        label: etiquetaDeVariante(v),
        price: v?.promotional_price != null ? Number(v.promotional_price)
          : v?.price != null ? Number(v.price) : null,
        // `stock: null` en Tiendanube significa "sin control de stock", que es
        // disponible. Tratarlo como cero escondía productos que sí se venden.
        available: v?.available !== false && v?.stock !== 0,
      }))
      .filter((v) => v.id)
      .slice(0, 24),
  });
}

/**
 * Cómo se llama esta variante para quien compra.
 *
 * Cada plataforma la nombra distinto: Shopify junta las opciones en `title`,
 * Tiendanube las trae como una lista de valores traducidos. Si no hay nada
 * legible se devuelve vacío y la tarjeta no dibuja el selector — mejor sin
 * selector que con opciones que dicen "Default Title".
 */
function etiquetaDeVariante(v: {
  title?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  values?: Array<{ es?: string; en?: string; pt?: string } | string> | null;
}): string {
  const deValores = (v.values ?? [])
    .map((x) => (typeof x === 'string' ? x : x?.es || x?.en || x?.pt || ''))
    .filter(Boolean)
    .join(' · ');
  if (deValores) return deValores;
  const opciones = [v.option1, v.option2, v.option3].filter(Boolean).join(' · ');
  if (opciones) return opciones;
  const t = (v.title ?? '').trim();
  // Shopify le pone este título a los productos SIN variantes.
  return t && t.toLowerCase() !== 'default title' ? t : '';
}

/**
 * El `handle` de una ficha, sea cual sea la forma de la dirección.
 *
 * `/products/serum-pilar`, `/productos/serum-pilar/`, `/producto/serum-pilar`
 * y cualquiera de esas con UTM detrás son el mismo producto. Lo único estable
 * es el último tramo del camino.
 */
function handleDeLaFicha(href: string): string | null {
  try {
    const u = new URL(href);
    const tramos = u.pathname.split('/').filter(Boolean);
    if (tramos.length < 2) return null;
    // La palabra que antecede tiene que ser la de una ficha: sin esto, la
    // portada de una categoría (`/collections/serums`) se resolvía como si
    // fuera un producto.
    const seccion = tramos[tramos.length - 2].toLowerCase();
    if (!['products', 'productos', 'product', 'producto'].includes(seccion)) return null;
    const handle = decodeURIComponent(tramos[tramos.length - 1]).trim().toLowerCase();
    return /^[a-z0-9][a-z0-9._-]{0,120}$/.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

/**
 * El enlace que compra ESTE producto, en la forma que entiende cada tienda.
 *
 * Es la misma que arma el agente (`armarLinkDeCompra`), salvo Shopify, cuyo
 * carrito por dirección no pasa por ahí. Sin esto la tarjeta de una
 * recomendación tendría foto y precio pero ningún botón que compre — media
 * tarjeta, que es peor que ninguna.
 */
function linkDeCompra(
  row: { url: string | null; platform: string | null },
  variantId: string,
): string | null {
  if (!variantId) return null;
  const plataforma = (row.platform || 'shopify').toLowerCase();
  const ficha = row.url ?? '';
  if (plataforma === 'shopify') {
    try {
      return `${new URL(ficha).origin}/cart/${variantId}:1`;
    } catch {
      return null;
    }
  }
  if (plataforma === 'tiendanube' || plataforma === 'woocommerce') {
    try {
      const raiz = new URL(ficha).origin;
      return (
        armarLinkDeCompra({
          tienda: { platform: plataforma, shop_domain: raiz } as never,
          id: variantId,
          cantidad: 1,
          productUrl: ficha,
        })?.url ?? null
      );
    } catch {
      return null;
    }
  }
  return null;
}
