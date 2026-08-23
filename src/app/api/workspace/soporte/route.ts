import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { permisoDeSoporte } from '@/lib/admin/support-access';

/**
 * El permiso para que soporte lea las conversaciones de esta cuenta.
 *
 *   GET  → si hay una ventana abierta y hasta cuándo.
 *   POST { horas, motivo } → la abre.
 *   DELETE → la cierra antes de tiempo.
 *
 * Lo decide el comercio y nadie más. Riverz no tiene forma de abrirla: no hay
 * ruta de admin que escriba en esta tabla, a propósito.
 *
 * Vence siempre. El tope es una semana porque un permiso largo es un permiso que
 * nadie se acuerda de sacar, y el problema que lo justificaba —«mirá por qué no
 * me contesta»— se resuelve en horas.
 */
export const runtime = 'nodejs';

const HORAS_POR_DEFECTO = 24;
const TOPE_HORAS = 24 * 7;

async function cuenta() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  return workspaceId ? { admin, workspaceId, userId: user.id } : null;
}

export async function GET() {
  const c = await cuenta();
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await permisoDeSoporte(c.workspaceId), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuenta();
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    horas?: number;
    motivo?: string;
  } | null;
  const horas = Math.min(
    Math.max(1, Math.round(Number(body?.horas) || HORAS_POR_DEFECTO)),
    TOPE_HORAS,
  );

  // Una sola ventana abierta por cuenta: la anterior se cierra antes de abrir
  // la nueva, o el índice único la rechaza.
  await c.admin
    .from('support_access')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', c.workspaceId)
    .is('revoked_at', null);

  const { error } = await c.admin.from('support_access').insert({
    workspace_id: c.workspaceId,
    granted_by: c.userId,
    expires_at: new Date(Date.now() + horas * 60 * 60 * 1000).toISOString(),
    reason: body?.motivo?.trim() || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(await permisoDeSoporte(c.workspaceId));
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuenta();
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Se marca revocada, no se borra: que el permiso existió es parte del
  // registro, igual que las lecturas que se hicieron mientras estuvo abierto.
  await c.admin
    .from('support_access')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', c.workspaceId)
    .is('revoked_at', null);

  return NextResponse.json(await permisoDeSoporte(c.workspaceId));
}
