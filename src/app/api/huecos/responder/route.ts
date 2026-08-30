import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { actualizarProducto } from '@/lib/products/write';
import { getLocale } from '@/lib/i18n/server';

/**
 * POST /api/huecos/responder — cargar la respuesta que faltaba.
 *
 * Cierra el bucle. El agente anota la pregunta que no supo contestar; acá esa
 * pregunta se convierte en conocimiento del producto y deja de faltar.
 *
 * Sin esto la pantalla de huecos era una lista de reproches: el comercio leía
 * "no supo contestar si el serum sirve para piel sensible", tenía que buscar el
 * producto, abrirlo, encontrar el campo y pegarlo a mano. La mitad no lo hacía,
 * y la misma pregunta volvía a la semana.
 *
 * Va a `custom_faqs` del producto y no a una tabla nueva: ahí ya vive lo que el
 * comercio agrega a mano, `buildTrainingMaterial` lo compila y el agente lo lee
 * verbatim. Una tabla aparte sería un segundo lugar donde buscar lo mismo.
 *
 * PERO NO TODO ES DEL PRODUCTO. "¿Puedo retirar en sucursal?", "¿hacen factura
 * A?", "¿cuánto tarda el envío?" son políticas del NEGOCIO: no cambian de un
 * producto a otro, y meterlas en la ficha de uno las hace desaparecer cuando el
 * cliente pregunta por otro. El comercio quedaba obligado a elegir un producto
 * al azar o a irse a otra pantalla a escribir una regla a mano — y la mitad no
 * lo hacía. Ahora el mismo formulario ofrece los dos destinos, y la regla
 * (`agent_guidance`) vale para toda la cuenta.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
    product_id?: unknown;
    question?: unknown;
    answer?: unknown;
    destino?: unknown;
  } | null;

  const key = typeof body?.key === 'string' ? body.key : '';
  const productId = typeof body?.product_id === 'string' ? body.product_id : '';
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 300) : '';
  const answer = typeof body?.answer === 'string' ? body.answer.trim().slice(0, 2000) : '';
  // Sin `destino` se comporta como antes: la pregunta va al producto. Es lo
  // que hacía la única versión que existía, y romper eso al agregar la otra
  // opción sería cambiarle el significado a las llamadas que ya andan.
  const destino = body?.destino === 'regla' ? 'regla' : 'producto';
  if (!key || !question || !answer || (destino === 'producto' && !productId)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  /** Marca el hueco cerrado. Recién después de guardar: si el guardado falla,
   *  la pregunta sigue en la lista en vez de perderse en silencio. */
  const cerrarHueco = async () => {
    await admin
      .from('answer_gaps')
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq('workspace_id', workspaceId)
      .eq('question_key', key)
      .is('resolved_at', null);
  };

  // ── La respuesta es una política del negocio ────────────────────────────
  //
  // Vale para toda la cuenta, no para un producto. `clave` la ata a ESTA
  // pregunta, así que responder dos veces la misma corrige la regla en vez de
  // acumular dos versiones que se contradicen.
  if (destino === 'regla') {
    const { error } = await admin.from('agent_guidance').upsert(
      {
        workspace_id: workspaceId,
        agent_id: null,
        titulo: question.slice(0, 120),
        cuando: `Preguntan: "${question}"`,
        hacer: answer,
        activa: true,
        origen: 'hueco',
        clave: `hueco_${key}`.slice(0, 200),
      },
      { onConflict: 'workspace_id,clave' },
    );
    if (error) {
      return NextResponse.json({ error: 'update_failed' }, { status: 502 });
    }
    await cerrarHueco();
    return NextResponse.json({ ok: true, destino: 'regla' });
  }

  const { data: producto } = await admin
    .from('shopify_products')
    .select('id, custom_faqs')
    .eq('id', productId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!producto) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const previas = Array.isArray((producto as { custom_faqs?: unknown }).custom_faqs)
    ? ((producto as { custom_faqs: Array<{ q?: string; a?: string }> }).custom_faqs ?? [])
    : [];
  // La misma pregunta cargada dos veces se reemplaza, no se duplica: si no, el
  // material del prompt junta respuestas contradictorias y el agente elige mal.
  const sinRepetir = previas
    .map((f) => ({ q: String(f?.q ?? '').trim(), a: String(f?.a ?? '').trim() }))
    .filter((f) => f.q && f.a && f.q.toLowerCase() !== question.toLowerCase());

  const res = await actualizarProducto(admin, {
    id: productId,
    cambios: { custom_faqs: [...sinRepetir, { q: question, a: answer }] },
    locale: await getLocale(),
    workspaceId,
  });
  if (!res.ok) return NextResponse.json({ error: 'update_failed' }, { status: 502 });

  // Recién ahora se marca resuelto: si el guardado falla, el hueco sigue en la
  // lista. Al revés se perdería la pregunta y nadie sabría que falta.
  await cerrarHueco();

  return NextResponse.json({ ok: true, destino: 'producto' });
}
