import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { readOutcomes, readThread } from '@/lib/dashboard/outcomes-query';
import { OUTCOME_CATEGORIES } from '@/lib/dashboard/outcomes';

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
    { status }
  );
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return error('outcomeUnauthorized', 401);
  const url = new URL(request.url);
  const start = Date.parse(url.searchParams.get('start') ?? '');
  const end = Date.parse(url.searchParams.get('end') ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    return error('outcomeInvalid', 400);
  try {
    return NextResponse.json(
      await readOutcomes(ctx.admin, ctx.workspaceId, {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[outcomes] read failed', err);
    return error('outcomeLoadFailed', 502);
  }
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await context();
  if (!ctx) return error('outcomeUnauthorized', 401);
  const body = await request.json().catch(() => null);
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !body ||
    typeof body.conversationId !== 'string' ||
    !uuid.test(body.conversationId) ||
    typeof body.lastMessageId !== 'string' ||
    !uuid.test(body.lastMessageId) ||
    (body.category !== null && !OUTCOME_CATEGORIES.includes(body.category))
  )
    return error('outcomeInvalid', 400);
  try {
    const thread = await readThread(
      ctx.admin,
      ctx.workspaceId,
      body.conversationId
    );
    if (!thread) return error('outcomeNotFound', 404);
    if (
      body.category !== null &&
      (thread.state === 'human' || thread.lastMessageId !== body.lastMessageId)
    )
      return error('outcomeChanged', 409);
    const result =
      body.category === null
        ? await ctx.admin
            .from('conversation_outcomes')
            .delete()
            .eq('workspace_id', ctx.workspaceId)
            .eq('conversation_id', thread.id)
        : await ctx.admin.from('conversation_outcomes').upsert(
            {
              conversation_id: thread.id,
              workspace_id: ctx.workspaceId,
              last_message_id: thread.lastMessageId,
              category: body.category,
              verified_by: ctx.userId,
              verified_at: new Date().toISOString(),
            },
            { onConflict: 'conversation_id' }
          );
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[outcomes] update failed', err);
    return error('outcomeSaveFailed', 502);
  }
}
