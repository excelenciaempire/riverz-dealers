import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), decide: vi.fn(), csrf: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ service: true }) }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: mocks.workspace }));
vi.mock('@/lib/approvals/resolve', () => ({ decidir: mocks.decide }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mocks.csrf }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
import { POST } from './route';

function request(body: unknown) {
  return POST(new Request('https://riverz.co/api/approvals/request-1/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: 'request-1' }) });
}
describe('approval panel authorization and decision contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: 'owner-1' } } });
    mocks.workspace.mockResolvedValue('workspace-from-session');
    mocks.decide.mockResolvedValue({ ok: true, message: 'Done' });
  });
  it('uses the authenticated workspace, ignoring a workspace supplied by the caller', async () => {
    const response = await request({ aprobar: true, workspaceId: 'someone-else' });
    expect(response.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith(expect.anything(), {
      approvalId: 'request-1', decision: 'aprobada', via: 'panel', decidedBy: 'owner-1', workspaceId: 'workspace-from-session',
    });
  });
  it('rejects a decision without an authenticated workspace', async () => {
    mocks.workspace.mockResolvedValue(null);
    expect((await request({ aprobar: true })).status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it('never executes a conflict or a string masquerading as a boolean', async () => {
    for (const body of [{ aprobar: 'true' }, { aprobar: true, decision: 'rechazada' }]) {
      const response = await request(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Choose approve or decline.');
    }
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it('requires a session and accepts an explicit rejection', async () => {
    expect((await request({ aprobar: false })).status).toBe(200);
    expect(mocks.decide.mock.calls[0][1].decision).toBe('rechazada');
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await request({ aprobar: true })).status).toBe(401);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });
  it('does not pass a failed CSRF check to the resolver', async () => {
    mocks.csrf.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await request({ aprobar: true })).status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
