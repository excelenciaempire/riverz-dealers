import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';

/**
 * Las devoluciones y los cambios que abrió el agente.
 *
 * GET   — la lista, primero lo que espera una decisión.
 * PATCH — mover una de estado, con la nota de por qué.
 *
 * Sin esto el dato entraba y no salía: el agente abría el caso con el pedido,
 * el motivo y las fotos, y el comercio no tenía dónde verlo — la mitad peor de
 * construir una funcionalidad.
 */
export const dynamic = 'force-dynamic';

const ESTADOS = ['abierta', 'aprobada', 'rechazada', 'recibida', 'resuelta'] as const;

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

export async function GET(request: Request) {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const estado = new URL(request.url).searchParams.get('estado');
  let q = ctx.admin
    .from('returns')
    .select(
      'id, order_number, kind, reason, customer_note, photos, status, resolution, created_at, decided_at, contact_id, conversation_id, contacts(name, email, phone)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (estado && (ESTADOS as readonly string[]).includes(estado)) q = q.eq('status', estado);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 502 });

  const filas = (data ?? []) as Array<Record<string, unknown>>;
  // Lo que espera una decisión va primero, aunque sea más viejo: es la lista de
  // trabajo, no un registro histórico.
  const peso = (s: unknown) => (s === 'abierta' ? 0 : s === 'recibida' ? 1 : s === 'aprobada' ? 2 : 3);
  filas.sort((a, b) => peso(a.status) - peso(b.status));

  return NextResponse.json({ returns: filas });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    status?: unknown;
    resolution?: unknown;
  } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!id || !(ESTADOS as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { error } = await ctx.admin
    .from('returns')
    .update({
      status,
      resolution:
        typeof body?.resolution === 'string' ? body.resolution.trim().slice(0, 500) || null : null,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    // El recorte de cuenta: sin esto un id suelto movía la devolución de otro
    // comercio, y esta ruta corre con llave de servicio.
    .eq('workspace_id', ctx.workspaceId);
  if (error) return NextResponse.json({ error: 'update_failed' }, { status: 502 });

  return NextResponse.json({ ok: true });
}
