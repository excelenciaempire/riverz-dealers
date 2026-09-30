import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCommerceActor } from '@/lib/admin/commerce-session';
import { recordAdminAction } from '@/lib/admin/audit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient, SESSION_COOKIE_OPTIONS } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { serverError } from '@/lib/api/errors';
import { signCommerceContext, verifyCommerceContext } from '@/lib/auth/commerce-policy';
import { COMMERCE_AUTH_COOKIE, COMMERCE_CONTEXT_COOKIE, COMMERCE_SELECTION_COOKIE, COMMERCE_TTL_SECONDS } from '@/lib/auth/commerce-cookies';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function failure(key: string, status: number) {
  return NextResponse.json({ error: translate(await getLocale(), key) }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const actor = await getCommerceActor();
  if (!actor) return failure('nav.commerceForbidden', 403);
  try {
    const db = supabaseAdmin();
    const rows: { id: string; name: string; owner_id: string; email: string | null }[] = [];
    // Include every live commerce, not only the first page or admin memberships.
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await db.from('workspaces').select('id, name, owner_id')
        .is('deleted_at', null).order('name').order('id').range(offset, offset + 199);
      if (error) throw error;
      const page = (data ?? []) as { id: string; name: string; owner_id: string }[];
      if (page.length) {
        const { data: profiles, error: profileError } = await db.from('profiles')
          .select('user_id, email').in('user_id', [...new Set(page.map((v) => v.owner_id))]);
        if (profileError) throw profileError;
        const emails = new Map((profiles ?? []).map((v: { user_id: string; email: string | null }) => [v.user_id, v.email]));
        rows.push(...page.map((v) => ({ ...v, email: emails.get(v.owner_id) ?? null })));
      }
      if (page.length < 200) break;
    }
    const jar = await cookies();
    const ctx = verifyCommerceContext(jar.get(COMMERCE_CONTEXT_COOKIE)?.value);
    const actingWorkspaceId = ctx?.actorId === actor.userId ? ctx.workspaceId : null;
    const base = await createClient({ actor: true });
    const { data: { user } } = await base.auth.getUser();
    const originalWorkspaceId = user ? await resolveWorkspaceIdForUser(db, user.id) : null;
    await recordAdminAction(actor, request, { action: 'view.workspaces', meta: { surface: 'commerce_switcher', count: rows.length } });
    return NextResponse.json({ rows, activeWorkspaceId: actingWorkspaceId ?? originalWorkspaceId,
      actingWorkspaceId, canReturn: Boolean(user) }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err, translate(await getLocale(), 'nav.commerceLoadFailed'));
  }
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const actor = await getCommerceActor();
  if (!actor) return failure('nav.commerceForbidden', 403);
  const rate = await limitByKey(`commerce-switch:${actor.userId}`, { limit: 30, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);
  const body: unknown = await request.json().catch(() => null);
  const id = body && typeof body === 'object' && 'workspaceId' in body ? body.workspaceId : null;
  if (typeof id !== 'string' || !uuid.test(id)) return failure('nav.commerceNotFound', 400);
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('workspaces').select('id, name, owner_id')
      .eq('id', id).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    if (!data) return failure('nav.commerceNotFound', 404);
    const workspace = data as { id: string; name: string; owner_id: string };
    const { data: owner, error: ownerError } = await db.auth.admin.getUserById(workspace.owner_id);
    if (ownerError || !owner.user?.email) throw ownerError ?? new Error('commerce_owner_unavailable');

    // Build the signature first: a missing signing key cannot leave a half-switched login.
    const context = signCommerceContext({ actorId: actor.userId, ownerId: workspace.owner_id, workspaceId: id });
    const previousContext = verifyCommerceContext((await cookies()).get(COMMERCE_CONTEXT_COOKIE)?.value);
    const commerce = await createClient({ commerceSession: true });
    const { data: previous } = await commerce.auth.getSession();
    // generateLink does NOT send email. It establishes a distinct owner session
    // so existing RLS, realtime and legacy user_id integrations keep their scope.
    const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: owner.user.email });
    if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error('commerce_session_link_failed');
    const { data: verified, error: verificationError } = await commerce.auth.verifyOtp({
      type: 'magiclink', token_hash: link.properties.hashed_token,
    });
    if (verificationError || verified.user?.id !== workspace.owner_id) throw verificationError ?? new Error('commerce_session_owner_mismatch');
    const jar = await cookies();
    jar.set(COMMERCE_CONTEXT_COOKIE, context, { ...SESSION_COOKIE_OPTIONS, httpOnly: true, maxAge: COMMERCE_TTL_SECONDS });
    jar.set(COMMERCE_SELECTION_COOKIE, id, { ...SESSION_COOKIE_OPTIONS, httpOnly: false, maxAge: COMMERCE_TTL_SECONDS });
    if (previous.session?.access_token && previous.session.access_token !== verified.session?.access_token) {
      // Revoke only the previous delegated session; never the merchant's own sessions.
      await db.auth.admin.signOut(previous.session.access_token, 'local').catch(() => {});
    }
    await recordAdminAction(actor, request, { action: 'enter.workspace', targetType: 'workspace', targetId: id,
      meta: { owner_id: workspace.owner_id, previous_workspace_id: previousContext?.workspaceId ?? null } });
    return NextResponse.json({ ok: true, workspaceId: id }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err, translate(await getLocale(), 'nav.commerceSwitchFailed'));
  }
}

/** Clearing one's own delegated session remains available after admin expiry. */
export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const actor = await getCommerceActor();
  const jar = await cookies();
  const ctx = verifyCommerceContext(jar.get(COMMERCE_CONTEXT_COOKIE)?.value);
  const commerce = await createClient({ commerceSession: true });
  const { data: current } = await commerce.auth.getSession();
  if (current.session?.access_token) {
    await supabaseAdmin().auth.admin.signOut(current.session.access_token, 'local').catch(() => {});
  }
  for (const cookie of jar.getAll()) {
    if (cookie.name === COMMERCE_CONTEXT_COOKIE || cookie.name === COMMERCE_SELECTION_COOKIE ||
        cookie.name === COMMERCE_AUTH_COOKIE || cookie.name.startsWith(`${COMMERCE_AUTH_COOKIE}.`)) {
      jar.set(cookie.name, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    }
  }
  if (actor && ctx) await recordAdminAction(actor, request, { action: 'exit.workspace', targetType: 'workspace', targetId: ctx.workspaceId });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
