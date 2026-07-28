import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';

/**
 * A qué comercios cubre la clave de Riverz cuando el modo es "selected".
 *
 *   PUT { workspace_id, enabled } → lo incluye o lo saca.
 *
 * Sacar a un comercio no lo deja sin IA: pasa a BYOK, o sea que responde con
 * la clave que tenga cargada en su agente. Si no tiene ninguna, deja de
 * contestar — y por eso la respuesta devuelve `has_own_key`, para que el panel
 * pueda avisarlo antes de que el comercio se entere por un cliente sin
 * atender.
 */
export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    enabled?: boolean;
  } | null;
  if (!body?.workspace_id || typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'workspace_id and enabled required' },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();
  const { error } = await db.from('platform_ai_workspaces').upsert(
    {
      workspace_id: body.workspace_id,
      enabled: body.enabled,
      created_by: gate.actor.userId,
    },
    { onConflict: 'workspace_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ¿Queda con red si lo sacamos? Sólo el hecho de que exista una clave
  // propia; nunca la clave.
  const { data: agents } = await db
    .from('ai_agents')
    .select('id')
    .eq('workspace_id', body.workspace_id)
    .not('api_key_encrypted', 'is', null)
    .limit(1);

  await recordAdminAction(gate.actor, request, {
    action: 'update.platform_ai_workspace',
    targetType: 'workspace',
    targetId: body.workspace_id,
    meta: { enabled: body.enabled },
  });

  return NextResponse.json({
    ok: true,
    has_own_key: (agents ?? []).length > 0,
  });
}
