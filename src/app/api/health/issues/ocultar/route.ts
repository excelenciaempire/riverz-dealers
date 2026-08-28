import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';

interface Body {
  /** Avisos que se ocultan, tal como los devolvió GET /api/health/issues. */
  issues?: { kind?: string; refId?: string; lastAt?: string | null }[];
}

/**
 * POST /api/health/issues/ocultar
 *
 * Oculta avisos de "Necesita tu atención" hasta el momento en que pasaron.
 *
 * Antes esto vivía en localStorage y no servía para nada: la firma guardada
 * incluía el conteo, así que el mismo problema volvía a aparecer con el
 * siguiente fallo — y encima sólo para ese navegador, así que la persona de al
 * lado lo seguía viendo. Ahora se guarda por cuenta y con fecha: se oculta lo
 * que ya pasó, no la clase de problema. Si vuelve a pasar, vuelve a aparecer.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const filas = (body?.issues ?? [])
    .filter((i) => typeof i?.kind === 'string' && i.kind)
    .map((i) => ({
      workspace_id: workspaceId,
      kind: i.kind as string,
      ref_id: i.refId ?? '',
      // Sin fecha, se oculta lo de hasta ahora: cualquier cosa posterior vuelve.
      hidden_through: i.lastAt ?? new Date().toISOString(),
      dismissed_at: new Date().toISOString(),
      dismissed_by: user.id,
    }));

  if (filas.length === 0) return NextResponse.json({ ok: true, hidden: 0 });

  try {
    const { error } = await supabaseAdmin()
      .from('health_issue_dismissals')
      .upsert(filas, { onConflict: 'workspace_id,kind,ref_id' });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, hidden: filas.length });
  } catch (err) {
    return serverError(err);
  }
}
