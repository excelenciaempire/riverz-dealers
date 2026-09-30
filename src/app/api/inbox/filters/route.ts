import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { savedViewConfig } from '@/lib/inbox/saved-views';
import { UUID } from '@/lib/inbox/collaboration';
import { supabaseAdmin } from '@/lib/automations/admin-client';

/**
 * GET /api/inbox/filters — lista los filtros guardados del usuario.
 * POST /api/inbox/filters — crea uno nuevo. Body: { name, config }
 * DELETE /api/inbox/filters?id=... — elimina uno (RLS protege que sea del user).
 */

export async function GET() {
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
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ filters: [], user_id: user.id });
  const { data, error } = await supabase
    .from('inbox_saved_filters')
    .select('id, name, config, sort_order,is_shared,user_id')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    return serverError(error);
  }
  const filters = [];
  const ownConnections = await supabase.from('channel_connections').select('id').eq('created_by', user.id).in('channel', ['gmail', 'outlook', 'zoho']);
  if (ownConnections.error) return serverError(ownConnections.error, translate(locale, 'inbox.teamFailed'));
  const emailIds = (ownConnections.data ?? []).map(c => c.id);
  for (const row of data ?? []) {
    const config = savedViewConfig(row.config);
    if (!config) { filters.push({ ...row, count: null, supported: false }); continue; }
    const q = supabase.from('conversations').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).is('deleted_at', null).not('last_message_at', 'is', null);
    if (emailIds.length) q.or(`channel.not.in.(gmail,outlook,zoho),connection_id.in.(${emailIds.join(',')})`);
    else q.not('channel', 'in', '(gmail,outlook,zoho)');
    if (config.channel) q.eq('channel', config.channel);
    if (config.case_priority) q.eq('case_priority', config.case_priority);
    if (config.case_reason) q.eq('case_reason', config.case_reason);
    if (config.assigned_agent_id) q.eq('assigned_agent_id', config.assigned_agent_id);
    if (config.status === 'snoozed') q.gt('snoozed_until', new Date().toISOString());
    else q.or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
    if (config.status === 'snoozed') { /* Snooze is independent of the conversation's status. */ }
    else if (config.status === 'mine') q.eq('assigned_agent_id', user.id);
    else if (config.status === 'unassigned') q.is('assigned_agent_id', null);
    else if (config.status === 'unread') q.gt('unread_count', 0).or('last_sender_type.is.null,last_sender_type.eq.customer');
    else if (config.status) q.eq('status', config.status);
    const result = await q;
    filters.push({ ...row, count: result.error ? null : result.count ?? 0, supported: true });
  }
  const memberships = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  if (memberships.error) return serverError(memberships.error, translate(locale, 'inbox.teamFailed'));
  const memberIds = (memberships.data ?? []).map(m => String(m.user_id));
  const profiles = memberIds.length ? await supabaseAdmin().from('profiles').select('user_id,full_name').in('user_id', memberIds) : { data: [], error: null };
  if (profiles.error) return serverError(profiles.error, translate(locale, 'inbox.teamFailed'));
  const members = memberIds.map(id => ({ id, name: profiles.data?.find(p => p.user_id === id)?.full_name ?? translate(locale, 'inbox.teamMember') }));
  return NextResponse.json({ filters, members, user_id: user.id }, { headers: { 'Cache-Control': 'private, no-store' } });
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
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    config?: Record<string, unknown>;
    is_shared?: boolean;
  } | null;
  const config = savedViewConfig(body?.config ?? {});
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || !config ||
    (body.is_shared !== undefined && typeof body.is_shared !== 'boolean')) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingName') },
      { status: 400 },
    );
  }
  // Resuelve workspace del usuario.
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.noWorkspace') },
      { status: 400 },
    );
  }
  const quota = await supabase.from('inbox_saved_filters').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('user_id', user.id);
  if (quota.error) return serverError(quota.error, translate(locale, 'inbox.teamFailed'));
  if ((quota.count ?? 0) >= 50) return NextResponse.json({ error: translate(locale, 'inbox.viewLimit') }, { status: 409 });
  const { data, error } = await supabase
    .from('inbox_saved_filters')
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      name: body.name.trim(),
      config,
      is_shared: body.is_shared ?? false,
    })
    .select('id, name, config, sort_order,is_shared,user_id')
    .single();
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ filter: data }, { status: 201 });
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
  if (!id || !UUID.test(id)) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingId') },
      { status: 400 },
    );
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: translate(locale, 'inbox.teamNotFound') }, { status: 404 });
  const { data, error } = await supabase
    .from('inbox_saved_filters')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('workspace_id', workspaceId).select('id').maybeSingle();
  if (error) {
    return serverError(error);
  }
  if (!data) return NextResponse.json({ error: translate(locale, 'inbox.teamNotFound') }, { status: 404 });
  return NextResponse.json({ ok: true });
}
