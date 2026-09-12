import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), admin: vi.fn(), csrf: vi.fn(), configured: vi.fn(), matches: vi.fn(), issue: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock('@/lib/auth/platform-admin', () => ({ isPlatformAdmin: mocks.admin }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mocks.csrf }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/admin/unlock', () => ({
  unlockConfigured: mocks.configured, passwordMatches: mocks.matches, issueToken: mocks.issue,
  UNLOCK_COOKIE: 'riverz_admin_unlock', UNLOCK_TTL_MS: 43200000,
}));
import { POST } from './route';

let identity = 0;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  mocks.auth.mockResolvedValue({ data: { user: { id: `admin-test-${identity++}`, email: 'admin@example.test' } } });
  mocks.admin.mockReturnValue(true);
  mocks.csrf.mockResolvedValue(null);
  mocks.configured.mockReturnValue(true);
  mocks.matches.mockReturnValue(false);
  mocks.issue.mockReturnValue('synthetic-unlock-token');
});
function request(password: unknown) {
  return new Request('https://riverz.test/api/admin/unlock', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID() },
    body: JSON.stringify({ password }),
  });
}

it('bounds concurrent password guesses for the same identity despite rotating headers', async () => {
  const replies = await Promise.all(Array.from({ length: 50 }, () => POST(request('wrong'))));
  expect(replies.filter(reply => reply.status === 401)).toHaveLength(5);
  const blocked = replies.filter(reply => reply.status === 429);
  expect(blocked).toHaveLength(45);
  expect(Number(blocked[0].headers.get('retry-after'))).toBeGreaterThan(0);
  expect(await blocked[0].json()).toEqual({ error: 'Too many attempts. Try again later.' });
  expect(mocks.matches).toHaveBeenCalledTimes(5);
  expect(mocks.issue).not.toHaveBeenCalled();
});
it.each([null, 123, {}, [], true, 'a'.repeat(1025)])('handles malformed password inputs without a server error', async password => {
  const reply = await POST(request(password));
  expect(reply.status).toBe(401);
  expect(await reply.json()).toEqual({ error: 'Incorrect password' });
  expect(mocks.matches).not.toHaveBeenCalled();
});
it('requires both administrator identity and CSRF before checking a password', async () => {
  mocks.admin.mockReturnValue(false);
  expect((await POST(request('secret'))).status).toBe(404);
  expect(mocks.matches).not.toHaveBeenCalled();
  mocks.csrf.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await POST(request('secret'))).status).toBe(403);
  expect(mocks.issue).not.toHaveBeenCalled();
});
it('issues an HTTP-only cookie after a valid password', async () => {
  mocks.matches.mockReturnValue(true);
  const reply = await POST(request('correct'));
  expect(reply.status).toBe(200);
  expect(reply.headers.get('set-cookie')).toContain('HttpOnly');
  expect(mocks.issue).toHaveBeenCalledWith('admin@example.test');
});
