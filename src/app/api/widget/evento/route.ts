import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';
import { contarPasoEnMeta, type PasoDelEmbudo } from '@/lib/marketing/meta-conversions';

/**
 * POST /api/widget/evento — los pasos del embudo, contados donde ocurren.
 *
 * Meta ya se enteraba de los dos extremos: `Contact` cuando alguien abre la
 * conversación y `Purchase` cuando compra. En el medio, nada. Para el algoritmo
 * una persona que eligió su producto y tocó "ir a pagar" era idéntica a otra
 * que preguntó el horario y se fue — y con contra-entrega, donde la venta se
 * confirma días después, esa ceguera dura todo ese tiempo.
 *
 * El evento se arma ACÁ y no en el navegador por dos razones: el id tiene que
 * ser el mismo que dispara el píxel de la tienda (si no, Meta cuenta dos), y
 * la mitad de la gente bloquea el píxel — por la API de Conversiones el evento
 * llega igual.
 *
 * Devuelve el `event_id` sólo cuando el evento es NUEVO. Con eso el chat sabe
 * si además tiene que disparar el píxel del navegador: tocar dos veces el mismo
 * botón no son dos eventos.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as {
    paso?: unknown;
    variant?: unknown;
    cantidad?: unknown;
    valor?: unknown;
    moneda?: unknown;
  } | null;

  const paso = body?.paso;
  if (paso !== 'AddToCart' && paso !== 'InitiateCheckout') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const db = supabaseAdmin();

  // La conversación de este visitante. Sin ella no hay a qué atar el evento —
  // ni con qué deduplicarlo — así que no se cuenta nada.
  const { data: contactRow } = await db
    .from('contacts')
    .select('id, email, phone')
    .eq('workspace_id', guard.session.workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', guard.session.visitorId)
    .maybeSingle();
  const contact = contactRow as { id: string; email: string | null; phone: string | null } | null;
  if (!contact) return NextResponse.json({ ok: true, counted: false });

  const { data: convRow } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const conversationId = (convRow as { id: string } | null)?.id;
  if (!conversationId) return NextResponse.json({ ok: true, counted: false });

  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const texto = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : null;

  const { eventId } = await contarPasoEnMeta(db, {
    workspaceId: guard.session.workspaceId,
    conversationId,
    paso: paso as PasoDelEmbudo,
    variantId: texto(body?.variant, 32),
    cantidad: num(body?.cantidad),
    value: num(body?.valor),
    currency: texto(body?.moneda, 8),
    cliente: { email: contact.email, phone: contact.phone },
  });

  return NextResponse.json({ ok: true, counted: !!eventId, event_id: eventId });
}
