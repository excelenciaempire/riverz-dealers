import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { isUuid } from '@/lib/products/slug';
import { resincronizarImagenes } from '@/lib/products/imagenes';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/products/[id]/imagenes
 *
 * Vuelve a traer la galería completa del producto desde la plataforma donde
 * está publicado —y desde todas, si la publicación está unificada con otras—.
 * El sync del catálogo sólo guarda la foto principal, así que sin esto el
 * producto queda con una imagen aunque la tienda tenga ocho.
 *
 * Suma: no borra las fotos que el comercio subió a mano.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locale = await getLocale();

  // La URL puede venir por handle legible; el resto trabaja con el UUID.
  let productId = id;
  if (!isUuid(id)) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('id')
      .eq('handle', id)
      .maybeSingle();
    if (error) return serverError(error);
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    productId = (data as { id: string }).id;
  }

  try {
    const res = await resincronizarImagenes(supabase, supabaseAdmin(), {
      id: productId,
    });
    if (!res.ok) {
      if (res.motivo === 'no_existe') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: translate(locale, 'errProducts.noPlatformImages') },
        { status: 412 },
      );
    }
    return NextResponse.json({
      ok: true,
      images: res.resultado.imagenes,
      added: res.resultado.agregadas,
      platforms: res.resultado.plataformas,
    });
  } catch (err) {
    return serverError(err);
  }
}
