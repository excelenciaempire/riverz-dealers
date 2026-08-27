import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';

/**
 * GET /api/widget/product?variant=<id>
 *
 * Los datos de un producto para dibujar una tarjeta: foto, título y precio.
 *
 * Por qué por VARIANTE y no por producto: lo único que el chat tiene a mano es
 * el enlace de carrito que arma el agente (`/cart/<variante>:<cantidad>`), y
 * ahí sólo viaja el id de la variante. Con esto, ese enlace deja de ser un
 * botón pelado y pasa a ser una tarjeta con la foto y el precio — que en una
 * tienda es la mitad de la venta.
 *
 * El catálogo de un comercio es público (está en su tienda), pero igual va
 * detrás del token del chat y acotado a SU workspace: sirve de poco exponer un
 * endpoint por el que cualquiera enumere el catálogo de cualquier cuenta.
 */
export async function GET(request: Request) {
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) return guard.response;

  const variant = new URL(request.url).searchParams.get('variant')?.trim() ?? '';
  // Sólo dígitos: el valor entra en una consulta y sale de una URL que escribió
  // un modelo de lenguaje.
  if (!/^\d{1,20}$/.test(variant)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { data } = await supabaseAdmin()
    .from('shopify_products')
    .select('title, image_url, url, price_min, currency, raw')
    .eq('workspace_id', guard.session.workspaceId)
    // La variante vive dentro del volcado crudo de la tienda; `@>` usa el
    // índice GIN del jsonb en vez de recorrer el catálogo entero.
    .filter('raw->variants', 'cs', `[{"id":${variant}}]`)
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const row = data as {
    title: string | null;
    image_url: string | null;
    url: string | null;
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

  return NextResponse.json({
    title: row.title ?? '',
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
