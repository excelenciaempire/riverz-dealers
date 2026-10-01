import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ shown: true, session: vi.fn(), rpc: vi.fn(), csrf: vi.fn(), rate: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return m.shown; } }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: m.csrf }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: m.rate }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/ai/drive-server', async () => ({ ...await vi.importActual<typeof import('@/lib/ai/drive-server')>('@/lib/ai/drive-server'), driveSession: m.session }));
import { GET, POST } from './route';
const id = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222', ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks(); m.shown = true; m.csrf.mockResolvedValue(null); m.rate.mockResolvedValue({ success: true });
  m.session.mockResolvedValue({ db: { rpc: m.rpc }, workspaceId: id, agentId: id, actorId: actor });
  m.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});
const request = (body: unknown) => new Request('https://riverz.co/api/ai/agents/' + id + '/drive', { method: 'POST', body: JSON.stringify(body) });
describe('selected Drive sources stay scoped, authenticated and hidden', () => {
  it('hides reads and mutations before authentication while comparison is off', async () => {
    m.shown = false; expect((await GET(new Request('https://riverz.co'), ctx)).status).toBe(404); expect((await POST(request({ action: 'disconnect' }), ctx)).status).toBe(404);
    expect(m.session).not.toHaveBeenCalled(); expect(m.csrf).not.toHaveBeenCalled();
  });
  it('checks CSRF before session and state writes', async () => {
    m.csrf.mockResolvedValue(new Response(null, { status: 403 })); expect((await POST(request({ action: 'disconnect' }), ctx)).status).toBe(403); expect(m.session).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it('uses server identity and extracts a selected file ID instead of fetching its URL', async () => {
    expect((await POST(request({ action: 'add', file: 'https://docs.google.com/document/d/abcdefghijklmnop/edit' }), ctx)).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('manage_ai_drive_source', { p_workspace_id: id, p_actor_id: actor, p_agent_id: id,
      p_action: 'add', p_file_id: 'abcdefghijklmnop', p_id: null, p_revision: null });
  });
  it.each([{ action: 'add', file: 'https://internal.example/file' }, { action: 'disconnect', actor_id: id }, { action: 'retry', id, revision: 0 }, { action: 'activate', id, revision: 1 }])('rejects unscoped, malformed or activation input', async body => {
    expect((await POST(request(body), ctx)).status).toBe(422); expect(m.rpc).not.toHaveBeenCalled();
  });
  it('does not mutate after rate limiting and returns localized retry information', async () => {
    m.rate.mockResolvedValue({ success: false, reset: Date.now() + 3000 }); const response = await POST(request({ action: 'disconnect' }), ctx);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBeTruthy(); expect((await response.json()).error).not.toContain('assistant.'); expect(m.rpc).not.toHaveBeenCalled();
  });
  it('rejects extra list query parameters before reading credentials or sources', async () => {
    expect((await GET(new Request('https://riverz.co?workspace_id=other'), ctx)).status).toBe(422); expect(m.rpc).not.toHaveBeenCalled();
  });
});
