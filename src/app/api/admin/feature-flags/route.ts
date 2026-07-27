import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { csrfGuard } from '@/lib/csrf';
import { getFeatureFlags, FEATURES } from '@/lib/admin/feature-flags';

/**
 * Feature flags de plataforma (solo platform admin).
 *   GET → { flags: Record<key, enabled>, features: FEATURES }
 *   PUT { key, enabled } → prende/apaga una funcionalidad.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isPlatformAdmin(user.email))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const flags = await getFeatureFlags(supabaseAdmin());
  return NextResponse.json({ flags, features: FEATURES });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isPlatformAdmin(user.email))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
      { key: body.key, enabled: body.enabled, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: 'key' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
