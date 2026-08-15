import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet } from '@/lib/admin/route';
import { recordAdminAction } from '@/lib/admin/audit';
import { getFeatureFlags, FEATURES } from '@/lib/admin/feature-flags';

/**
 * Feature flags de plataforma (solo equipo Riverz).
 *   GET → { flags: Record<key, enabled>, features: FEATURES }
 *   PUT { key, enabled } → prende/apaga una funcionalidad para todas las cuentas.
 */
export async function GET(request: Request) {
  // Por `adminGet` como las otras: límite de ritmo, fila de auditoría y
  // `no-store`. Esta ruta y otras tres llamaban a `requireAdmin()` directo y se
  // saltaban los tres pasos.
  return adminGet(request, { action: 'view.feature_flags' }, async () => ({
    flags: await getFeatureFlags(supabaseAdmin()),
    features: FEATURES,
  }));
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    /** `null` borra la excepción del comercio y lo devuelve al valor global. */
    enabled?: boolean | null;
    /** Si viene, se escribe la excepción de ESE comercio, no el valor global. */
    workspaceId?: string;
  } | null;
  if (!body?.key) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }
  if (!FEATURES.some((f) => f.key === body.key)) {
    return NextResponse.json({ error: 'unknown feature' }, { status: 400 });
  }

  const db = supabaseAdmin();

  // ── Excepción de un comercio ──
  if (body.workspaceId) {
    // `null` = sacar la excepción. Es lo que devuelve la cuenta al valor
    // global, y hace falta que sea explícito: sin esto, una vez puesta la
    // excepción no habría forma de volver atrás.
    const { error } =
      body.enabled === null
        ? await db
            .from('workspace_feature_flags')
            .delete()
            .eq('workspace_id', body.workspaceId)
            .eq('key', body.key)
        : await db.from('workspace_feature_flags').upsert(
            {
              workspace_id: body.workspaceId,
              key: body.key,
              enabled: body.enabled,
              updated_at: new Date().toISOString(),
              updated_by: gate.actor.userId,
            },
            { onConflict: 'workspace_id,key' },
          );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.workspace_feature_flag',
      targetType: 'workspace',
      targetId: body.workspaceId,
      meta: { key: body.key, enabled: body.enabled },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Valor global ──
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled required' }, { status: 400 });
  }

  const { error } = await db.from('feature_flags').upsert(
    {
      key: body.key,
      enabled: body.enabled,
      updated_at: new Date().toISOString(),
      updated_by: gate.actor.userId,
    },
    { onConflict: 'key' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Apagar una funcionalidad acá la esconde para todos los comercios que no
  // tengan una excepción propia: queda rastro de quién lo hizo y cuándo.
  await recordAdminAction(gate.actor, request, {
    action: 'update.feature_flag',
    targetType: 'feature_flag',
    targetId: body.key,
    meta: { enabled: body.enabled },
  });

  return NextResponse.json({ ok: true });
}
