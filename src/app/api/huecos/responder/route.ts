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
  } | null;

  const key = typeof body?.key === 'string' ? body.key : '';
  const productId = typeof body?.product_id === 'string' ? body.product_id : '';
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 300) : '';
  const answer = typeof body?.answer === 'string' ? body.answer.trim().slice(0, 2000) : '';
  if (!key || !productId || !question || !answer) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
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
  await admin
    .from('answer_gaps')
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq('workspace_id', workspaceId)
    .eq('question_key', key)
    .is('resolved_at', null);

  return NextResponse.json({ ok: true });
}
