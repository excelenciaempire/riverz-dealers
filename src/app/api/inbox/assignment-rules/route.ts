import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/inbox/assignment-rules — lista reglas del workspace.
 * POST /api/inbox/assignment-rules — crea o updatea. Body:
 *   { id?, name, is_active, priority, kind, config }
 * DELETE /api/inbox/assignment-rules?id=
 *
 * Solo admins/owners pueden modificar (RLS lo enforce con el role).
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
  const { data, error } = await supabase
    .from('conversation_assignment_rules')
    .select('id, name, is_active, priority, kind, channel, config, created_at')
    .order('priority', { ascending: true });
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ rules: data ?? [] });
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
    id?: string;
    workspace_id?: string;
    name?: string;
    is_active?: boolean;
    priority?: number;
    kind?: 'round_robin' | 'by_tag' | 'by_channel' | 'by_keyword';
    channel?: string | null;
    config?: Record<string, unknown>;
  } | null;
  if (!body?.name || !body.kind || !body.workspace_id) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingRuleFields') },
      { status: 400 },
    );
  }
  // Verificamos que el caller sea admin/owner del workspace REQUERIDO,
  // no del primer workspace_members row que Postgres haya devuelto. Un
  // admin de dos workspaces no debería poder crear reglas para el
  // workspace equivocado desde la UI del otro.
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
  // 013_unified_inbox.sql solo define 'admin' | 'agent', pero la
  // política RLS de 032_assignment_rules.sql usa 'owner', así que
  // permitimos ambos para forward-compat.
  if (!['admin', 'owner'].includes(member.role)) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.rulesAdminsOnly') },
      { status: 403 },
    );
  }
  // `channel` se trata como "cualquiera" cuando el cliente manda null o
  // string vacío — no hay que persistir un literal "cualquiera" porque
  // ya tenemos un valor canónico (NULL) en la columna.
  const channelValue =
    typeof body.channel === 'string' && body.channel.length > 0
      ? body.channel
      : null;
  if (body.id) {
    const { error } = await supabase
      .from('conversation_assignment_rules')
      .update({
        name: body.name,
        is_active: body.is_active ?? true,
        priority: body.priority ?? 100,
        kind: body.kind,
        channel: channelValue,
        config: body.config ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('workspace_id', body.workspace_id);
    if (error) return serverError(error);
    return NextResponse.json({ ok: true });
  }
  const { data, error } = await supabase
    .from('conversation_assignment_rules')
    .insert({
      workspace_id: body.workspace_id,
      name: body.name,
      is_active: body.is_active ?? true,
      priority: body.priority ?? 100,
      kind: body.kind,
      channel: channelValue,
      config: body.config ?? {},
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
  // Mismo guardia que en POST: verificamos membresía/role para el
  // workspace específico que se quiere afectar, no para una membresía
  // arbitraria del user.
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
    .from('conversation_assignment_rules')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
