import { NextResponse } from 'next/server';
import type { Contact } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { linkUnifiedContact } from '@/lib/contacts/dedupe';

/**
 * Con quién está unido este contacto, y cómo separarlo.
 *
 * La unión entre canales (migración 050) existía desde hacía meses y no se veía
 * en ninguna pantalla: el agente leía el historial del cliente unificado y el
 * comercio no tenía forma de saber que dos fichas eran una sola — ni de
 * arreglarlo cuando estaban mal. Un error de unión le muestra a una persona la
 * dirección y los pedidos de otra, así que "deshacer" no puede faltar.
 *
 * Va por la sesión del usuario y no con la clave de servicio: la RLS de
 * `contacts` ya acota al workspace de quien pregunta, así que nadie puede mirar
 * ni separar los contactos de otro comercio.
 */

/** El grupo: el primario y todas las fichas que apuntan a él. */
async function grupoDe(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<{ contacto: Contact; primarioId: string; hermanos: Contact[] } | null> {
  const { data } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
  const contacto = data as Contact | null;
  if (!contacto) return null;

  const primarioId = contacto.unified_contact_id ?? contacto.id;
  const { data: hermanos } = await supabase
    .from('contacts')
    .select('*')
    .or(`id.eq.${primarioId},unified_contact_id.eq.${primarioId}`)
    .neq('id', contacto.id);

  return { contacto, primarioId, hermanos: (hermanos ?? []) as Contact[] };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const grupo = await grupoDe(supabase, id);
  if (!grupo) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const c = grupo.contacto as Contact & { union_bloqueada?: boolean | null };
  return NextResponse.json({
    bloqueada: Boolean(c.union_bloqueada),
    // Sólo lo que hace falta para decir "es la misma persona que esta otra".
    hermanos: grupo.hermanos.map((h) => ({
      id: h.id,
      name: h.name,
      channel: h.channel,
      phone: h.phone,
      email: h.email,
    })),
  });
}

/**
 * PUT { separar: boolean }
 *
 * `separar: true` corta la unión Y la bloquea. Las dos cosas: sin el bloqueo,
 * el próximo mensaje entrante vuelve a juntarlas —el teléfono sigue
 * coincidiendo— y "deshacer" no existiría.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const block = await csrfGuard(request);
  if (block) return block;

  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { separar?: boolean } | null;
  if (typeof body?.separar !== 'boolean') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (body.separar) {
    const { error } = await supabase
      .from('contacts')
      .update({ unified_contact_id: null, union_bloqueada: true })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ bloqueada: true, hermanos: [] });
  }

  // Volver a permitir la unión: se levanta el freno y se reintenta ahora
  // mismo, para que el comercio vea el resultado y no tenga que esperar a que
  // esa persona escriba de nuevo.
  const { data } = await supabase
    .from('contacts')
    .update({ union_bloqueada: false })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  const contacto = data as Contact | null;
  if (contacto) await linkUnifiedContact(supabase, contacto).catch(() => contacto.id);

  const grupo = await grupoDe(supabase, id);
  return NextResponse.json({
    bloqueada: false,
    hermanos: (grupo?.hermanos ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      channel: h.channel,
      phone: h.phone,
      email: h.email,
    })),
  });
}
