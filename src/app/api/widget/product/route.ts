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
    raw: { images?: Array<{ src?: string }> } | null;
  };

  return NextResponse.json({
    title: row.title ?? '',
    // `image_url` está vacío en catálogos que se sincronizaron antes de que se
    // guardara; la foto igual está en el volcado crudo.
    image: row.image_url || row.raw?.images?.[0]?.src || null,
    url: row.url,
    price: row.price_min != null ? Number(row.price_min) : null,
    currency: row.currency,
  });
}
