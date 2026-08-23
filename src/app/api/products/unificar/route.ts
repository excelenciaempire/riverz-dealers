import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import {
  descartarGrupo,
  proponerUnificaciones,
  separarProducto,
  unificarProductos,
} from '@/lib/products/unify';

/**
 * El mismo producto vendido en varios lados.
 *
 * GET    — qué productos del catálogo son en realidad el mismo.
 * POST   — unirlos: una fila manda el conocimiento y las demás cuelgan.
 * DELETE — separar uno.
 *
 * Se propone y el comercio confirma. Unir dos productos distintos hace que el
 * agente cotice el precio equivocado y conteste con el conocimiento del
 * equivocado: es peor que el problema que esto resuelve, así que sólo el
 * emparejamiento por SKU —un código que el propio comercio puso en las dos
 * plataformas— se aplica solo, y eso pasa en la sincronización.
 */
export const dynamic = 'force-dynamic';

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return null;
  return { admin, workspaceId, userId: user.id };
}

export async function GET() {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ grupos: await proponerUnificaciones(ctx.admin, ctx.workspaceId) });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    master_id?: unknown;
    hijos?: unknown;
    dismiss?: unknown;
  } | null;

  // "No son el mismo producto." Se guarda el grupo para que la detección deje
  // de proponerlo: sin esto la misma propuesta equivocada vuelve para siempre y
  // el comercio aprende a ignorar el panel entero.
  if (typeof body?.dismiss === 'string' && body.dismiss) {
    const r = await descartarGrupo(ctx.admin, {
      workspaceId: ctx.workspaceId,
      key: body.dismiss,
      userId: ctx.userId,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  }
  const masterId = typeof body?.master_id === 'string' ? body.master_id : '';
  const hijos = Array.isArray(body?.hijos)
    ? (body.hijos as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  if (!masterId || hijos.length === 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const res = await unificarProductos(ctx.admin, {
    workspaceId: ctx.workspaceId,
    masterId,
    hijos,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.motivo }, { status: res.motivo === 'error_db' ? 502 : 400 });
  }
  return NextResponse.json({ ok: true, unidos: res.unidos });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const res = await separarProducto(ctx.admin, { workspaceId: ctx.workspaceId, productId: id });
  return NextResponse.json(res, { status: res.ok ? 200 : 502 });
}
