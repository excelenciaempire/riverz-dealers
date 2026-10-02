import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { readOutcomes } from '@/lib/dashboard/outcomes-query';
import { DashboardAccessError } from '@/lib/dashboard/access';
import { dashboardHeaders, outcomeBody, outcomeDecision, outcomeRange } from '@/lib/dashboard/http';

export const dynamic = 'force-dynamic';

async function context() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  return workspaceId ? { admin, workspaceId, userId: user.id } : null;
}
async function error(key: string, status: number) {
  return NextResponse.json(
    { error: translate(await getLocale(), `dashboard.${key}`) },
    { status, headers: dashboardHeaders }
  );
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return error('outcomeUnauthorized', 401);
  const range = outcomeRange(request);
  if (!range) return error('outcomeInvalid', 400);
  try {
    return NextResponse.json(
      await readOutcomes(ctx.admin, ctx.workspaceId, range, ctx.userId),
      { headers: dashboardHeaders }
    );
  } catch (err) {
    if (err instanceof DashboardAccessError) return error('outcomeForbidden', 403);
    console.error('[outcomes] read failed');
    return error('outcomeLoadFailed', 502);
  }
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) { block.headers.set('Cache-Control', dashboardHeaders['Cache-Control']); return block; }
  const ctx = await context();
  if (!ctx) return error('outcomeUnauthorized', 401);
  if (new URL(request.url).search) return error('outcomeInvalid', 400);
  const parsed = outcomeDecision.safeParse(await outcomeBody(request));
  if (!parsed.success) return error('outcomeInvalid', 400);
  const body = parsed.data;
  try {
    const result = await ctx.admin.rpc('write_dashboard_outcome', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId,
      p_conversation_id: body.conversationId, p_last_message_id: body.lastMessageId, p_category: body.category });
    if (result.error?.message === 'dashboard_outcome_not_found') return error('outcomeNotFound', 404);
    if (result.error?.message === 'dashboard_outcome_changed') return error('outcomeChanged', 409);
    if (result.error?.message === 'subscription_read_only') return error('outcomeReadOnly', 402);
    if (result.error || result.data?.ok !== true) throw new Error('outcome_save_unavailable');
    return NextResponse.json({ ok: true }, { headers: dashboardHeaders });
  } catch {
    console.error('[outcomes] update failed');
    return error('outcomeSaveFailed', 502);
  }
}
