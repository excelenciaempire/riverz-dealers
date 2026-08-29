import { NextResponse } from 'next/server';
import type { Contact, Conversation } from '@/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';
import { crearTraspaso, numeroDelComercio } from '@/lib/channels/webchat/seguir-en-whatsapp';

/**
 * POST /api/widget/whatsapp — seguir la conversación en WhatsApp.
 *
 * Devuelve el link de wa.me con el mensaje ya escrito. Lo manda la persona, no
 * nosotros: así no hace falta ninguna plantilla aprobada por Meta y la ventana
 * de 24 h se abre sola.
 *
 * Si todavía no escribió nada no hay ficha ni hilo que unir, y el link va sin
 * código: igual sirve para pasarse: simplemente empieza de cero del otro lado.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'whatsapp');
  if (!guard.ok) return guard.response;
  const { session, ctx } = guard;

  // El comercio tiene que haberlo activado. Sin esto, un widget viejo o una
  // llamada a mano abriría un canal que el comercio decidió no ofrecer.
  if (ctx.config.whatsapp_handoff !== true) {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  const db = supabaseAdmin();
  const body = (await request.json().catch(() => null)) as { saludo?: unknown } | null;
  const saludoCrudo = typeof body?.saludo === 'string' ? body.saludo : '';
  // El saludo lo escribe el widget en el idioma del chat, pero el texto entra
  // en una URL que abre WhatsApp: se acota y se limpia de saltos de línea.
  const saludo =
    saludoCrudo.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Hola, vengo del chat de la web.';

  const { data: contactRow } = await db
    .from('contacts')
    .select('id')
    .eq('workspace_id', session.workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', session.visitorId)
    .maybeSingle();
  const contact = contactRow as Pick<Contact, 'id'> | null;

  if (!contact) {
    // Abrió el chat y no escribió: no hay conversación que llevarse. Se le da
    // el número igual, sin código — no se crea una ficha para quien todavía no
    // dijo nada.
    const numero = await numeroDelComercio(db, session.workspaceId);
    if (!numero) return NextResponse.json({ error: 'whatsapp_not_connected' }, { status: 404 });
    return NextResponse.json({
      url: `https://wa.me/${numero}?text=${encodeURIComponent(saludo)}`,
    });
  }

  const { data: convRow } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const conversation = convRow as Pick<Conversation, 'id'> | null;

  const traspaso = await crearTraspaso(db, {
    workspaceId: session.workspaceId,
    contactId: contact.id,
    conversationId: conversation?.id ?? null,
    saludo,
  });
  if (!traspaso) {
    return NextResponse.json({ error: 'whatsapp_not_connected' }, { status: 404 });
  }

  return NextResponse.json({ url: traspaso.url });
}
