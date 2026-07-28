import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET/POST /api/ai/instagram-agent/settings
 *
 * The workspace's proactive Instagram controls: `paused` (kill-switch) +
 * `daily_cap` (rolling-24h max) + `auto_reply_comments` + `outreach_enabled`
 * (todos en ig_proactive_settings, migración 093). RLS scopes to members.
 *
 * Ya NO expone `send_mode`: el alcance proactivo es siempre automático y no
 * hay nada que aprobar. La opción se guardaba pero ninguna rama la leía, así
 * que elegir "approval" enviaba igual — una promesa que el producto no
 * cumplía. Se quita en vez de construir una cola de aprobación que nadie pidió.
 */

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
      outreach_enabled: true,
    });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  const { data } = workspaceId
    ? await supabase
        .from('ig_proactive_settings')
        .select(
          'paused, daily_cap, auto_reply_comments, outreach_enabled, comment_audience, comment_max_thread_replies',
        )
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    : { data: null };
  const s = data as {
    paused?: boolean;
    daily_cap?: number;
    auto_reply_comments?: boolean;
    outreach_enabled?: boolean;
    comment_audience?: string;
    comment_max_thread_replies?: number;
  } | null;
  return NextResponse.json({
    paused: s?.paused ?? false,
    daily_cap: s?.daily_cap ?? 500,
    // Sin fila de ajustes, ambas funcionalidades están encendidas (default BD).
    auto_reply_comments: s?.auto_reply_comments !== false,
    outreach_enabled: s?.outreach_enabled !== false,
    // Migración 132 — defaults = la conducta de siempre.
    comment_audience: s?.comment_audience === 'all' ? 'all' : 'intent',
    comment_max_thread_replies:
      typeof s?.comment_max_thread_replies === 'number'
        ? s.comment_max_thread_replies
        : 3,
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
    typeof body.auto_reply_comments === 'boolean' ||
    typeof body.outreach_enabled === 'boolean' ||
    body.comment_audience != null ||
    body.comment_max_thread_replies != null
  ) {
    const patch: Record<string, unknown> = { workspace_id: workspaceId };
    // A quién contesta la IA en comentarios y cuánto insiste (migración 132).
    // Valor desconocido ⇒ se ignora, no se guarda basura que rompa el CHECK.
    if (body.comment_audience === 'intent' || body.comment_audience === 'all') {
      patch.comment_audience = body.comment_audience;
    }
    if (body.comment_max_thread_replies != null) {
      patch.comment_max_thread_replies = Math.max(
        0,
        Math.min(10, Math.round(Number(body.comment_max_thread_replies)) || 0),
      );
    }
    if (typeof body.paused === 'boolean') patch.paused = body.paused;
    if (typeof body.auto_reply_comments === 'boolean') {
      patch.auto_reply_comments = body.auto_reply_comments;
    }
    if (typeof body.outreach_enabled === 'boolean') {
      patch.outreach_enabled = body.outreach_enabled;
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

  // `send_mode` ya no existe: el alcance proactivo es siempre automático,
  // no hay nada que aprobar. Lo que decide si se escribe son las puertas
  // reales — spam/intención, el contrato del agente y el límite diario.

  return NextResponse.json({ success: true });
}
