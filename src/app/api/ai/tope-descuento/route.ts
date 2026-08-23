import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { isWorkspaceAdmin } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';

/**
 * Cuánto puede descontar el agente, como máximo.
 *
 * El número existía y se leía en tres lugares —la pizarra para decidir si
 * ofrecer la herramienta, el runner para armar su descripción, y
 * `mintUniqueCode` para recortar lo que el modelo proponga— pero **no había
 * forma de escribirlo**: ni pantalla, ni endpoint. Nacía en 0 y con 0 la
 * herramienta ni siquiera se le ofrece al agente, así que "Ofrecer un
 * descuento" era un interruptor que no se podía encender nunca.
 *
 * Vive acá y no en los ajustes del chat porque es de la CUENTA: el mismo tope
 * gobierna a todos los agentes y todos los canales. Un descuento es margen, y
 * el margen no se decide por canal.
 */
export const dynamic = 'force-dynamic';

/** Techo duro. Más que esto no es un descuento, es regalar el producto. */
const MAXIMO = 50;

async function resolver(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }

  const workspaceId =
    new URL(request.url).searchParams.get('workspace_id') ??
    (await request
      .clone()
      .json()
      .then((b) => (b as { workspace_id?: string })?.workspace_id)
      .catch(() => null));
  if (!workspaceId) {
    return { error: NextResponse.json({ error: 'bad_request' }, { status: 400 }) };
  }

  const { data: miembro } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  // 404 y no 403: quien no es de la cuenta no tiene por qué enterarse de que
  // existe.
  if (!miembro) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }

  return { userId: user.id, workspaceId };
}

export async function GET(request: Request) {
  const r = await resolver(request);
  if ('error' in r) return r.error;

  const { data } = await supabaseAdmin()
    .from('workspace_checkout_config')
    .select('max_discount_percent')
    .eq('workspace_id', r.workspaceId)
    .maybeSingle();

  const n = Number((data as { max_discount_percent?: number } | null)?.max_discount_percent ?? 0);
  return NextResponse.json({ tope: Number.isFinite(n) ? n : 0, maximo: MAXIMO });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const r = await resolver(request);
  if ('error' in r) return r.error;

  // Decidir cuánto se regala es de administración, como conectar un cobro.
  if (!(await isWorkspaceAdmin(supabaseAdmin(), r.userId, r.workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { tope?: unknown } | null;
  const crudo = Math.floor(Number(body?.tope));
  if (!Number.isFinite(crudo) || crudo < 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const tope = Math.min(MAXIMO, crudo);

  // `upsert` y no `update`: la fila de configuración de checkout puede no
  // existir todavía —se crea al conectar la tienda— y el tope tiene que poder
  // fijarse antes, cuando el comercio está armando su agente.
  const { error } = await supabaseAdmin()
    .from('workspace_checkout_config')
    .upsert({ workspace_id: r.workspaceId, max_discount_percent: tope }, { onConflict: 'workspace_id' });
  if (error) {
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, tope });
}
