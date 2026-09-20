import { afterEach, describe, expect, it, vi } from 'vitest';
const readiness = vi.hoisted(() => vi.fn());
vi.mock('@/lib/automations/activation', () => ({ reconcileWorkspaceAutomationReadiness: readiness }));
import { reconcileTemplateStatus } from './reconcile-template-status';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('template eligibility reconciliation', () => {
  it('scopes updates to workspace, WABA, name and language and preserves content', async () => {
    const query = { eq: vi.fn().mockReturnThis(), then: (done: (v: unknown) => void) => done({ error: null }) };
    const update = vi.fn().mockReturnValue(query);
    const db = { from: vi.fn().mockReturnValue({ update }) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { name: 'order', language: 'es', status: 'PAUSED', category: 'MARKETING', quality_score: { score: 'RED' } },
    ] }))));
    await reconcileTemplateStatus(db as never, { workspaceId: 'w', wabaId: 'b', accessToken: 'token' });
    expect(query.eq.mock.calls).toEqual([['workspace_id', 'w'], ['waba_id', 'b'], ['name', 'order'], ['language', 'es']]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ meta_status: 'PAUSED', status: 'Approved', category: 'Marketing', quality_score: 'RED' }));
    expect(update.mock.calls[0][0]).not.toHaveProperty('body_text');
    expect(readiness).toHaveBeenCalledWith(db, 'w');
  });
});
