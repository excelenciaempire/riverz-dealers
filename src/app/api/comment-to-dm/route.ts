import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * Comentario → DM (auto-DM on IG/FB comments) rules CRUD.
 *
 * GET    /api/comment-to-dm[?workspace_id=]  — list rules (+ dm_sent counts)
 * POST   /api/comment-to-dm                  — create or update (body.id present)
 * DELETE /api/comment-to-dm?id=&workspace_id= — delete
 *
 * Admins/owners only for writes (RLS enforces it too). The engine that
 * actually sends lives in `src/lib/comment-to-dm/engine.ts`.
 */

type RuleBody = {
  id?: string;
  workspace_id?: string;
  name?: string;
  channel?: 'ig_comment' | 'fb_comment';
  post_id?: string | null;
  keywords?: string[];
  match_type?: 'contains' | 'exact';
  case_sensitive?: boolean;
  public_reply_enabled?: boolean;
  public_reply_templates?: string[];
  dm_message?: string;
  dm_button_label?: string | null;
  dm_button_url?: string | null;
  is_active?: boolean;
  priority?: number;
};

const RULE_COLUMNS =
  'id, name, channel, post_id, keywords, match_type, case_sensitive, public_reply_enabled, public_reply_templates, dm_message, dm_button_label, dm_button_url, is_active, priority, created_at';

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
}

export async function GET(request: Request) {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.unauthorized') },
      { status: 401 },
    );
  }
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  let query = supabase
    .from('comment_to_dm_rules')
    .select(RULE_COLUMNS)
    .order('priority', { ascending: true });
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query;
  if (error) return serverError(error);

  // Derive "DMs enviados" per rule from the log in one query (RLS-scoped).
  const ruleIds = (data ?? []).map((r) => (r as { id: string }).id);
  const counts: Record<string, number> = {};
  if (ruleIds.length > 0) {
    const { data: logs } = await supabase
      .from('comment_to_dm_log')
      .select('rule_id, dm_status')
      .in('rule_id', ruleIds)
      .eq('dm_status', 'sent');
    for (const row of (logs ?? []) as { rule_id: string }[]) {
      counts[row.rule_id] = (counts[row.rule_id] ?? 0) + 1;
    }
  }
  const rules = (data ?? []).map((r) => ({
    ...(r as Record<string, unknown>),
    dm_sent_count: counts[(r as { id: string }).id] ?? 0,
  }));
  return NextResponse.json({ rules });
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
      { error: translate(locale, 'errInbox.unauthorized') },
      { status: 401 },
    );
  }
  const body = (await request.json().catch(() => null)) as RuleBody | null;
  if (
    !body?.workspace_id ||
    !body.name?.trim() ||
    !body.channel ||
    !body.dm_message?.trim()
  ) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingRuleFields') },
      { status: 400 },
    );
  }
  if (body.channel !== 'ig_comment' && body.channel !== 'fb_comment') {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingRuleFields') },
      { status: 400 },
    );
  }

  // Verify the caller is admin/owner of the SPECIFIC workspace being written.
  const { data: member } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('workspace_id', body.workspace_id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.noWorkspace') },
      { status: 403 },
    );
  }
  if (!['admin', 'owner'].includes(member.role)) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.rulesAdminsOnly') },
      { status: 403 },
    );
  }

  const postId =
    typeof body.post_id === 'string' && body.post_id.trim().length > 0
      ? body.post_id.trim()
      : null;
  const buttonUrl =
    typeof body.dm_button_url === 'string' && body.dm_button_url.trim().length > 0
      ? body.dm_button_url.trim()
      : null;
  const buttonLabel =
    typeof body.dm_button_label === 'string' &&
    body.dm_button_label.trim().length > 0
      ? body.dm_button_label.trim()
      : null;

  const fields = {
    name: body.name.trim(),
    channel: body.channel,
    post_id: postId,
    keywords: cleanStrings(body.keywords),
    match_type: body.match_type === 'exact' ? 'exact' : 'contains',
    case_sensitive: Boolean(body.case_sensitive),
    public_reply_enabled: body.public_reply_enabled ?? true,
    public_reply_templates: cleanStrings(body.public_reply_templates),
    dm_message: body.dm_message.trim(),
    dm_button_label: buttonLabel,
    dm_button_url: buttonUrl,
    is_active: body.is_active ?? true,
    priority: typeof body.priority === 'number' ? body.priority : 100,
  };

  if (body.id) {
    const { error } = await supabase
      .from('comment_to_dm_rules')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', body.id)
      .eq('workspace_id', body.workspace_id);
    if (error) return serverError(error);
    return NextResponse.json({ ok: true });
  }

  const { data, error } = await supabase
    .from('comment_to_dm_rules')
    .insert({
      workspace_id: body.workspace_id,
      created_by: user.id,
      ...fields,
    })
    .select('id')
    .single();
  if (error) return serverError(error);
  return NextResponse.json({ rule: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.unauthorized') },
      { status: 401 },
    );
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const workspaceId = url.searchParams.get('workspace_id');
  if (!id || !workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingIdOrWorkspace') },
      { status: 400 },
    );
  }
  const { data: member } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!member) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.noWorkspace') },
      { status: 403 },
    );
  }
  if (!['admin', 'owner'].includes(member.role)) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.rulesAdminsOnly') },
      { status: 403 },
    );
  }
  const { error } = await supabase
    .from('comment_to_dm_rules')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
