import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET/POST /api/ai/instagram-agent/settings
 *
 * The workspace's proactive Instagram controls: `paused` (kill-switch) and
 * `daily_cap` (rolling-24h max). RLS (migration 093) scopes to members.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ paused: false, daily_cap: 500 });

  const { data } = await supabase
    .from('ig_proactive_settings')
    .select('paused, daily_cap')
    .maybeSingle();
  const s = data as { paused?: boolean; daily_cap?: number } | null;
  return NextResponse.json({
    paused: s?.paused ?? false,
    daily_cap: s?.daily_cap ?? 500,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }
  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.noWorkspace') },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { workspace_id: workspaceId };
  if (typeof body.paused === 'boolean') patch.paused = body.paused;
  if (body.daily_cap != null) {
    patch.daily_cap = Math.max(0, Math.min(10000, Math.round(Number(body.daily_cap)) || 0));
  }

  const { error } = await supabase
    .from('ig_proactive_settings')
    .upsert(patch, { onConflict: 'workspace_id' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
