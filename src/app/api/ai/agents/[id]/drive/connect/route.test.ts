import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const m = vi.hoisted(() => ({ shown: true, csrf: vi.fn(), session: vi.fn(), rpc: vi.fn(), set: vi.fn(), url: vi.fn(), limit: vi.fn(), encrypted: '' }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return m.shown; } }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: m.csrf }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: m.limit }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.set }) }));
vi.mock('@/lib/channels/encryption', () => ({ encrypt: (value: string) => { m.encrypted = value; return 'encrypted-verifier'; } }));
vi.mock('@/lib/ai/drive-provider', async () => ({ ...await vi.importActual<typeof import('@/lib/ai/drive-provider')>('@/lib/ai/drive-provider'), driveAuthorizationUrl: m.url }));
vi.mock('@/lib/ai/drive-server', async () => ({ ...await vi.importActual<typeof import('@/lib/ai/drive-server')>('@/lib/ai/drive-server'), driveSession: m.session }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/base-url', () => ({ publicBaseUrl: () => 'https://riverz.co' }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const req = (body?: string) => new Request('https://riverz.co/api/ai/agents/' + id + '/drive/connect', { method: 'POST', ...(body ? { body } : {}) });
const invoke = (body?: string) => POST(req(body), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks(); m.shown = true; m.encrypted = ''; m.csrf.mockResolvedValue(null); m.limit.mockResolvedValue({ success: true });
  m.session.mockResolvedValue({ workspaceId: id, agentId: id, actorId: actor, db: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: true, error: null }); m.url.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?state=opaque');
});
describe('Drive consent start', () => {
  it('is hidden before authentication or cookie changes', async () => {
    m.shown = false; expect((await invoke()).status).toBe(404); expect(m.csrf).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled(); expect(m.set).not.toHaveBeenCalled();
  });
  it('requires CSRF and an empty bounded request', async () => {
    m.csrf.mockResolvedValueOnce(new Response(null, { status: 403 })); expect((await invoke()).status).toBe(403);
    expect((await invoke('{}')).status).toBe(422); expect(m.rpc).not.toHaveBeenCalled(); expect(m.set).not.toHaveBeenCalled();
  });
  it('binds random consent to current actor, hashed browser cookie and PKCE verifier', async () => {
    const response = await invoke(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ url: m.url.mock.results[0].value });
    const stored = m.rpc.mock.calls[0][1], cookie = m.set.mock.calls[0][1];
    expect(stored).toMatchObject({ p_actor_id: actor, p_workspace_id: id, p_agent_id: id, p_verifier_ciphertext: 'encrypted-verifier' });
    expect(stored.p_state_hash).toBe(createHash('sha256').update(m.url.mock.calls[0][0].state).digest('hex'));
    expect(stored.p_cookie_hash).toBe(createHash('sha256').update(cookie).digest('hex'));
    expect(m.url.mock.calls[0][0].challenge).toBe(createHash('sha256').update(m.encrypted).digest('base64url'));
    expect(m.encrypted).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(m.set.mock.calls[0]).toEqual(['riverz_drive_consent', expect.stringMatching(/^[a-f0-9]{64}$/), { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/ai/drive' }]);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('does not save state or cookies if provider configuration is unavailable', async () => {
    m.url.mockImplementationOnce(() => { throw new Error('private configuration'); }); expect((await invoke()).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.set).not.toHaveBeenCalled();
  });
  it('does not change the consent cookie after database refusal', async () => {
    m.rpc.mockResolvedValueOnce({ data: false, error: null }); expect((await invoke()).status).toBe(503); expect(m.set).not.toHaveBeenCalled();
  });
  it('limits consent attempts without storing state', async () => {
    m.limit.mockResolvedValueOnce({ success: false, reset: Date.now() + 10_000 }); expect((await invoke()).status).toBe(429); expect(m.rpc).not.toHaveBeenCalled();
  });
});
