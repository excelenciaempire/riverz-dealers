import { NextResponse } from 'next/server';
import type { Contact } from '@/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { linkUnifiedContact } from '@/lib/contacts/dedupe';
import { requireSession } from '@/lib/channels/webchat/guard';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('widget.identify');

/**
 * POST /api/widget/identify — ponerle nombre al visitante.
 *
 * Quien entra al chat es anónimo: un id que guardó su navegador. Cuando dice
 * su correo —porque el comercio se lo pide antes de escribir, porque el agente
 * se lo pregunta para buscar un pedido, o porque compra— deja de serlo, y ahí
 * este contacto tiene que dejar de ser un desconocido más para convertirse en
 * el cliente que el comercio ya conocía por WhatsApp o por Shopify.
 *
 * Eso lo resuelve `linkUnifiedContact`, que es lo mismo que ya une al mismo
 * humano entre canales (migración 050): a partir de acá el agente lee su
 * historial y sus compras aunque la conversación haya empezado sin saber quién
 * era.
 *
 * Sólo agrega. Un dato que el visitante escribe no pisa el que el comercio ya
 * tenía: un nombre mal tipeado en un chat no puede renombrar a un cliente.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'identify');
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    name?: string;
    phone?: string;
  } | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200);
  const name = (body.name ?? '').trim().slice(0, 120);
  const phone = (body.phone ?? '').trim().slice(0, 32);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }
  if (!email && !name && !phone) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data } = await admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', session.visitorId)
    .maybeSingle();
  const contact = data as Contact | null;
  if (!contact) {
    // Todavía no escribió nada. No se crea el contacto acá: un visitante que
    // sólo abrió el widget no es una fila en la base de nadie.
    return NextResponse.json({ ok: true, linked: false });
  }

  const patch: Record<string, string> = {};
  if (email && !contact.email) patch.email = email;
  if (name && !contact.name) patch.name = name;
  if (phone && !contact.phone) patch.phone = phone;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, linked: false });
  }

  const { data: updated, error } = await admin
    .from('contacts')
    .update(patch)
    .eq('id', contact.id)
    .select('*')
    .single();
  if (error) {
    log.captureException(error, { workspaceId: session.workspaceId });
    return NextResponse.json({ error: 'update_failed' }, { status: 502 });
  }

  const primaryId = await linkUnifiedContact(admin, updated as Contact).catch(() => contact.id);
  return NextResponse.json({ ok: true, linked: primaryId !== contact.id });
}
