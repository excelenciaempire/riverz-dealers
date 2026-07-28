import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { getFeatureFlags, FEATURES } from '@/lib/admin/feature-flags';

/**
 * Feature flags de plataforma (solo equipo Riverz).
 *   GET → { flags: Record<key, enabled>, features: FEATURES }
 *   PUT { key, enabled } → prende/apaga una funcionalidad para todas las cuentas.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const flags = await getFeatureFlags(supabaseAdmin());
  return NextResponse.json({ flags, features: FEATURES });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    enabled?: boolean;
  } | null;
  if (!body?.key || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'key and enabled required' }, { status: 400 });
  }
  if (!FEATURES.some((f) => f.key === body.key)) {
    return NextResponse.json({ error: 'unknown feature' }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from('feature_flags')
    .upsert(
      {
        key: body.key,
        enabled: body.enabled,
        updated_at: new Date().toISOString(),
        updated_by: gate.actor.userId,
      },
      { onConflict: 'key' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Apagar una funcionalidad la esconde para TODOS los comercios: queda rastro
  // de quién lo hizo y cuándo.
  await recordAdminAction(gate.actor, request, {
    action: 'update.feature_flag',
    targetType: 'feature_flag',
    targetId: body.key,
    meta: { enabled: body.enabled },
  });

  return NextResponse.json({ ok: true });
}
