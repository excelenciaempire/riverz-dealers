import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { userAccess } from '@/lib/mcp/access';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
async function context() {
  const session = await createClient({ actor: true });
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const workspaceId = await resolveWorkspaceIdForUser(session, user.id);
  if (!workspaceId || !await userAccess(supabaseAdmin(), user.id, workspaceId)) return null;
  return { userId: user.id, workspaceId };
}
const failure = (status: number) => NextResponse.json({ error: 'connection_check_failed' }, { status });

export async function POST(request: Request) {
  const blocked = await csrfGuard(request); if (blocked) return blocked;
  const ctx = await context(); if (!ctx) return failure(401);
  const rate = await limitByKey(`mcp-check:${ctx.userId}`, { limit: 12, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);
  const body = await request.json().catch(() => null);
  if (!['chatgpt', 'claude', 'codex'].includes(body?.provider)) return failure(400);
  const { data, error } = await supabaseAdmin().from('mcp_connection_checks')
    .insert({ user_id: ctx.userId, workspace_id: ctx.workspaceId, provider: body.provider })
    .select('id, expires_at').single();
  if (error) return failure(503);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const ctx = await context(); if (!ctx) return failure(401);
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return failure(400);
  const db = supabaseAdmin();
  const { data, error } = await db.from('mcp_connection_checks').select('id, created_at, expires_at, verified_at, token_id')
    .eq('id', id).eq('user_id', ctx.userId).eq('workspace_id', ctx.workspaceId).maybeSingle();
  if (error) return failure(503);
  if (!data) return failure(404);
  const { data: tokens, error: tokenError } = await db.from('mcp_tokens').select('id')
    .eq('workspace_id', ctx.workspaceId).eq('created_by', ctx.userId).eq('origin', 'oauth')
    .is('revoked_at', null).gt('expires_at', new Date().toISOString());
  if (tokenError) return failure(503);
  const verified = !!data.verified_at && tokens?.some(t => t.id === data.token_id);
  return NextResponse.json({
    status: Date.parse(data.expires_at) <= Date.now() ? 'expired' : verified ? 'verified' : tokens?.length ? 'authorized' : 'waiting',
    verified_at: verified ? data.verified_at : null, expires_at: data.expires_at,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
