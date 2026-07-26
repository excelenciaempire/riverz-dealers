import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { resolveIgAgent, type ProactiveSendMode } from '@/lib/instagram-agent/agent-link';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET/POST /api/ai/instagram-agent/settings
 *
 * The workspace's proactive Instagram controls: `paused` (kill-switch) +
 * `daily_cap` (rolling-24h max, both on ig_proactive_settings, migration 093)
 * AND `send_mode` (auto | hybrid_intent | approval), which lives on the active
 * agent (ai_agents.proactive_send_mode) — surfaced here so it's configurable in
 * one place instead of buried in the agent editor. RLS scopes to members.
 */
const VALID_MODES: ProactiveSendMode[] = ['auto', 'hybrid_intent', 'approval'];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({
      paused: false,
      daily_cap: 500,
      auto_reply_comments: true,
      send_mode: 'auto',
    });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  const [{ data }, agent] = await Promise.all([
    workspaceId
      ? supabase
          .from('ig_proactive_settings')
          .select('paused, daily_cap, auto_reply_comments')
          .eq('workspace_id', workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    workspaceId
      ? resolveIgAgent(supabase, workspaceId)
      : Promise.resolve({ id: null, proactive_send_mode: 'auto' as ProactiveSendMode }),
  ]);
  const s = data as {
    paused?: boolean;
    daily_cap?: number;
    auto_reply_comments?: boolean;
  } | null;
  return NextResponse.json({
    paused: s?.paused ?? false,
    daily_cap: s?.daily_cap ?? 500,
    // Sin fila de ajustes, el piso autónomo está encendido (default de la BD).
    auto_reply_comments: s?.auto_reply_comments !== false,
    send_mode: agent.proactive_send_mode,
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

  // Workspace-level controls (pause + cap).
  if (
    typeof body.paused === 'boolean' ||
    body.daily_cap != null ||
    typeof body.auto_reply_comments === 'boolean'
  ) {
    const patch: Record<string, unknown> = { workspace_id: workspaceId };
    if (typeof body.paused === 'boolean') patch.paused = body.paused;
    if (typeof body.auto_reply_comments === 'boolean') {
      patch.auto_reply_comments = body.auto_reply_comments;
    }
    if (body.daily_cap != null) {
      patch.daily_cap = Math.max(
        0,
        Math.min(10000, Math.round(Number(body.daily_cap)) || 0),
      );
    }
    const { error } = await supabase
      .from('ig_proactive_settings')
      .upsert(patch, { onConflict: 'workspace_id' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Automation mode lives on the active agent.
  if (
    typeof body.send_mode === 'string' &&
    VALID_MODES.includes(body.send_mode as ProactiveSendMode)
  ) {
    const agent = await resolveIgAgent(supabase, workspaceId);
    if (agent.id) {
      await supabase
        .from('ai_agents')
        .update({ proactive_send_mode: body.send_mode })
        .eq('id', agent.id);
    }
  }

  return NextResponse.json({ success: true });
}
