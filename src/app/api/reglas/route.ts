import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { MAX_REGLAS } from '@/lib/ai/guidance';

/**
 * Las reglas del comercio (migración 200).
 *
 *   GET    /api/reglas          — todas, activas y apagadas.
 *   POST   /api/reglas          — crea una. { titulo, cuando?, hacer, agent_id? }
 *   PATCH  /api/reglas?id=…     — edita o prende/apaga.
 *   DELETE /api/reglas?id=…     — borra.
 *
 * Va con el cliente de sesión y no con la llave de servicio: la RLS de la
 * tabla ya recorta por cuenta, así que no hace falta resolver el workspace
 * para leer, y para escribir se resuelve una vez y la política vuelve a
 * comprobarlo.
 */

const MAX_TITULO = 80;
const MAX_TEXTO = 600;

async function sesion() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { error: translate(locale, 'errInbox.unauthorized') },
        { status: 401 },
      ),
    };
  }
  return { supabase, user, locale };
}

export async function GET() {
  const s = await sesion();
  if ('error' in s) return s.error;

  const { data, error } = await s.supabase
    .from('agent_guidance')
    .select('id, agent_id, titulo, cuando, hacer, activa, orden, origen, clave')
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return serverError(error);
  return NextResponse.json({ reglas: data ?? [] });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const s = await sesion();
  if ('error' in s) return s.error;

  const body = (await request.json().catch(() => null)) as {
    titulo?: unknown;
    cuando?: unknown;
    hacer?: unknown;
    agent_id?: unknown;
  } | null;

  const texto = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const titulo = texto(body?.titulo, MAX_TITULO);
  const hacer = typeof body?.hacer === 'string' ? body.hacer.trim().slice(0, MAX_TEXTO) : '';
  if (!titulo || !hacer) {
    return NextResponse.json(
      { error: translate(s.locale, 'errInbox.missingName') },
      { status: 400 },
    );
  }

  const { data: member } = await s.supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', s.user.id)
    .limit(1)
    .maybeSingle();
  if (!member?.workspace_id) {
    return NextResponse.json(
      { error: translate(s.locale, 'errInbox.noWorkspace') },
      { status: 400 },
    );
  }

  // Un tope, y el mismo que el del prompt: dejar cargar cincuenta reglas de
  // las que sólo entran veinticinco es prometer algo que no pasa.
  const { count } = await s.supabase
    .from('agent_guidance')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', member.workspace_id);
  if ((count ?? 0) >= MAX_REGLAS) {
    return NextResponse.json({ error: 'too_many' }, { status: 409 });
  }

  const { data, error } = await s.supabase
    .from('agent_guidance')
    .insert({
      workspace_id: member.workspace_id,
      agent_id: typeof body?.agent_id === 'string' && body.agent_id ? body.agent_id : null,
      titulo,
      cuando: texto(body?.cuando, MAX_TEXTO) || null,
      hacer,
      orden: count ?? 0,
    })
    .select('id, agent_id, titulo, cuando, hacer, activa, orden, origen, clave')
    .single();
  if (error) return serverError(error);
  return NextResponse.json({ regla: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const s = await sesion();
  if ('error' in s) return s.error;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { error: translate(s.locale, 'errInbox.missingId') },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    titulo?: unknown;
    cuando?: unknown;
    hacer?: unknown;
    activa?: unknown;
  } | null;

  const patch: Record<string, unknown> = {};
  if (typeof body?.titulo === 'string') {
    patch.titulo = body.titulo.replace(/\s+/g, ' ').trim().slice(0, MAX_TITULO);
  }
  if (typeof body?.cuando === 'string') {
    patch.cuando = body.cuando.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO) || null;
  }
  if (typeof body?.hacer === 'string') patch.hacer = body.hacer.trim().slice(0, MAX_TEXTO);
  if (typeof body?.activa === 'boolean') patch.activa = body.activa;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { data, error } = await s.supabase
    .from('agent_guidance')
    .update(patch)
    .eq('id', id)
    .select('id, agent_id, titulo, cuando, hacer, activa, orden, origen, clave')
    .maybeSingle();
  if (error) return serverError(error);
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ regla: data });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const s = await sesion();
  if ('error' in s) return s.error;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { error: translate(s.locale, 'errInbox.missingId') },
      { status: 400 },
    );
  }
  const { error } = await s.supabase.from('agent_guidance').delete().eq('id', id);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
