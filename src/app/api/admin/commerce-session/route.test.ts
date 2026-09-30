import { beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { signCommerceContext, verifyCommerceContext } from '@/lib/auth/commerce-policy';
import { COMMERCE_CONTEXT_COOKIE, COMMERCE_SELECTION_COOKIE } from '@/lib/auth/commerce-cookies';

const m = vi.hoisted(() => ({ actor: vi.fn(), csrf: vi.fn(), from: vi.fn(), getOwner: vi.fn(), generateLink: vi.fn(), revoke: vi.fn(), verifyOtp: vi.fn(), session: vi.fn(), original: vi.fn(), audit: vi.fn(), resolve: vi.fn(), jar: new Map<string, string>(), set: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => m.jar.has(name) ? { name, value: m.jar.get(name) } : undefined, getAll: () => [...m.jar].map(([name, value]) => ({ name, value })), set: m.set }) }));
vi.mock('@/lib/admin/commerce-session', () => ({ getCommerceActor: m.actor }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: m.audit }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: m.from, auth: { admin: { getUserById: m.getOwner, generateLink: m.generateLink, signOut: m.revoke } } }) }));
vi.mock('@/lib/supabase/server', () => ({ SESSION_COOKIE_OPTIONS: { path: '/', sameSite: 'lax' }, createClient: async (options: { actor?: boolean }) => ({ auth: options.actor ? { getUser: m.original } : { getSession: m.session, verifyOtp: m.verifyOtp } }) }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: m.csrf }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: true }), rateLimitResponse: vi.fn() }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: m.resolve }));
vi.mock('@/lib/api/errors', () => ({ serverError: () => NextResponse.json({ error: 'unavailable' }, { status: 500 }) }));
import { DELETE, GET, POST } from './route';

const actorId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const previousId = '44444444-4444-4444-8444-444444444444';
const row = { id, owner_id: ownerId, name: 'Nativa Store' };
const request = () => new Request('https://riverz.co/api/admin/commerce-session', { method: 'POST', body: JSON.stringify({ workspaceId: id }) });
function query(data: unknown) {
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn(), in: vi.fn(), maybeSingle: vi.fn() };
  for (const method of ['select', 'eq', 'is', 'order'] as const) builder[method].mockReturnValue(builder);
  for (const method of ['range', 'in', 'maybeSingle'] as const) builder[method].mockResolvedValue({ data, error: null });
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks(); m.jar.clear();
  m.actor.mockResolvedValue({ userId: actorId, email: 'juandiegoriosmesa@gmail.com' });
  m.csrf.mockResolvedValue(null);
  m.from.mockReturnValue(query(row));
  m.getOwner.mockResolvedValue({ data: { user: { id: ownerId, email: 'nativa@riverz.co' } }, error: null });
  m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'private-onetime-token' } }, error: null });
  m.verifyOtp.mockResolvedValue({ data: { user: { id: ownerId }, session: { access_token: 'new-delegated-session' } }, error: null });
  m.session.mockResolvedValue({ data: { session: { access_token: 'previous-delegated-session' } } });
  m.original.mockResolvedValue({ data: { user: { id: actorId } } });
  m.resolve.mockResolvedValue('original-workspace');
  m.revoke.mockResolvedValue({ error: null });
  m.set.mockImplementation((name: string, value: string) => m.jar.set(name, value));
  m.jar.set('sb-project-auth-token', 'original-admin-login');
});

it('blocks ordinary merchants before listing stores or generating a session', async () => {
  m.actor.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect((await GET(new Request('https://riverz.co/api/admin/commerce-session'))).status).toBe(403);
  expect(m.from).not.toHaveBeenCalled();
  expect(m.generateLink).not.toHaveBeenCalled();
});
it('requires CSRF and never mints a login for an absent or deleted store', async () => {
  m.csrf.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect(m.actor).not.toHaveBeenCalled();
  const builder = query(null); m.from.mockReturnValue(builder);
  expect((await POST(request())).status).toBe(404);
  expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
  expect(m.generateLink).not.toHaveBeenCalled();
});
it('keeps the original login, binds target workspace and audits the previous store without exposing tokens', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, signCommerceContext({ actorId, ownerId, workspaceId: previousId }));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, workspaceId: id });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(m.jar.get('sb-project-auth-token')).toBe('original-admin-login');
  expect(m.set.mock.calls.every(([name]) => name !== 'sb-project-auth-token')).toBe(true);
  expect(verifyCommerceContext(m.jar.get(COMMERCE_CONTEXT_COOKIE))).toMatchObject({ actorId, ownerId, workspaceId: id });
  expect(m.jar.get(COMMERCE_SELECTION_COOKIE)).toBe(id);
  expect(m.set).toHaveBeenCalledWith(COMMERCE_CONTEXT_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true }));
  expect(m.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'nativa@riverz.co' });
  expect(m.revoke).toHaveBeenCalledWith('previous-delegated-session', 'local');
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: 'enter.workspace', targetId: id, meta: { owner_id: ownerId, previous_workspace_id: previousId } }));
});
it('does not publish a selection when verification returns the wrong owner', async () => {
  m.verifyOtp.mockResolvedValue({ data: { user: { id: actorId }, session: null }, error: null });
  expect((await POST(request())).status).toBe(500);
  expect(m.set).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it('returns to the original login by clearing only delegated cookies and revoking only that session', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, signCommerceContext({ actorId, ownerId, workspaceId: id }));
  m.jar.set(COMMERCE_SELECTION_COOKIE, id);
  m.jar.set('riverz-commerce-auth.0', 'delegated-cookie');
  expect((await DELETE(new Request('https://riverz.co/api/admin/commerce-session', { method: 'DELETE' }))).status).toBe(200);
  expect(m.jar.get('sb-project-auth-token')).toBe('original-admin-login');
  expect(m.revoke).toHaveBeenCalledWith('previous-delegated-session', 'local');
  expect(m.jar.get(COMMERCE_SELECTION_COOKIE)).toBe('');
  expect(m.jar.get('riverz-commerce-auth.0')).toBe('');
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: 'exit.workspace', targetId: id }));
});
it('lists beyond the first 200 stores and preserves the original return option', async () => {
  const workspaces = query(null);
  workspaces.range.mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, n) => ({ ...row, id: `store-${n}` })), error: null })
    .mockResolvedValueOnce({ data: [row], error: null });
  const profiles = query([{ user_id: ownerId, email: 'nativa@riverz.co' }]);
  m.from.mockImplementation((table: string) => table === 'workspaces' ? workspaces : profiles);
  const response = await GET(new Request('https://riverz.co/api/admin/commerce-session'));
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.rows).toHaveLength(201);
  expect(result.activeWorkspaceId).toBe('original-workspace');
  expect(result.canReturn).toBe(true);
  expect(workspaces.range).toHaveBeenCalledWith(200, 399);
});
