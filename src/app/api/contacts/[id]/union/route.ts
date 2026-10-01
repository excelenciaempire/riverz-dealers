import { NextResponse } from 'next/server';
import type { Contact } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { UUID } from '@/lib/inbox/collaboration';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

const headers = { 'Cache-Control': 'private, no-store' };
async function failure(status: number) {
  return NextResponse.json({ error: translate(await getLocale(), 'contacts.unionFailed') }, { status, headers });
}

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
  if (!contacto?.workspace_id) return null;

  const primarioId = contacto.unified_contact_id ?? contacto.id;
  const { data: hermanos } = await supabase
    .from('contacts')
    .select('*')
    .eq('workspace_id', contacto.workspace_id)
    .or(`id.eq.${primarioId},unified_contact_id.eq.${primarioId}`)
    .neq('id', contacto.id);

  return { contacto, primarioId, hermanos: (hermanos ?? []) as Contact[] };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return failure(404);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failure(401);

  const grupo = await grupoDe(supabase, id);
  if (!grupo) return failure(404);

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
  }, { headers });
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
  if (!UUID.test(id)) return failure(404);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failure(401);

  const body = (await request.json().catch(() => null)) as { separar?: boolean } | null;
  if (typeof body?.separar !== 'boolean' || Object.keys(body).some(key => key !== 'separar')) {
    return failure(400);
  }

  const before = await grupoDe(supabase, id);
  if (!before) return failure(404);
  const saved = await supabase.rpc('set_contact_unification_block', { p_workspace_id: before.contacto.workspace_id, p_contact_id: id, p_separate: body.separar });
  if (saved.error || saved.data !== body.separar) return failure(saved.error?.message === 'subscription_read_only' ? 403 : saved.error?.message === 'invalid_contact_identity' ? 404 : 503);
  const grupo = await grupoDe(supabase, id);
  if (!grupo) return failure(503);
  return NextResponse.json({
    bloqueada: Boolean((grupo.contacto as Contact & { union_bloqueada?: boolean }).union_bloqueada),
    hermanos: grupo.hermanos.map((h) => ({
      id: h.id,
      name: h.name,
      channel: h.channel,
      phone: h.phone,
      email: h.email,
    })),
  }, { headers });
}
