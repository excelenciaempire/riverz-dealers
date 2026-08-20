import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import {
  createRule,
  deleteRule,
  isCompleteRuleInput,
  listRulesWithCounts,
  ruleFields,
  updateRule,
  type CommentRuleInput,
} from '@/lib/comment-to-dm/rules';

/**
 * Comentario → DM (auto-DM on IG/FB comments) rules CRUD.
 *
 * GET    /api/comment-to-dm[?workspace_id=]  — list rules (+ dm_sent counts)
 * POST   /api/comment-to-dm                  — create or update (body.id present)
 * DELETE /api/comment-to-dm?id=&workspace_id= — delete
 *
 * Admins/owners only for writes (RLS enforces it too). Esta ruta es sólo la
 * puerta HTTP: la sesión, el permiso y los códigos de estado. Las consultas
 * viven en `src/lib/comment-to-dm/rules.ts` para que el chat agéntico guarde
 * exactamente las mismas filas que el formulario. El motor que envía está en
 * `src/lib/comment-to-dm/engine.ts`.
 */

type RuleBody = CommentRuleInput & { id?: string; workspace_id?: string };

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
  const { rules, error } = await listRulesWithCounts(supabase, workspaceId);
  if (error) return serverError(error);
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
  if (!body?.workspace_id || !isCompleteRuleInput(body)) {
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

  const fields = ruleFields(body);

  if (body.id) {
    const { error } = await updateRule(supabase, {
      id: body.id,
      workspaceId: body.workspace_id,
      fields,
    });
    if (error) return serverError(error);
    return NextResponse.json({ ok: true });
  }

  const { rule, error } = await createRule(supabase, {
    workspaceId: body.workspace_id,
    createdBy: user.id,
    fields,
  });
  if (error) return serverError(error);
  return NextResponse.json({ rule }, { status: 201 });
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
  const { error } = await deleteRule(supabase, { id, workspaceId });
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
