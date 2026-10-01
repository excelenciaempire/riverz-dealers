import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ shown: true, auth: vi.fn(), recovery: vi.fn(), from: vi.fn(), resume: vi.fn(), failed: false }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return m.shown; } }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ from: m.from }) }));
vi.mock('@/lib/flows/http-recorded-recovery', () => ({ recoverRecordedHttpFlows: m.recovery }));
vi.mock('@/lib/flows/resume', () => ({ resumeFlowRun: m.resume }));
vi.mock('@/lib/flows/engine', () => ({ nextRetryDelayMs: () => 60_000 }));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: m.auth }));
vi.mock('@/lib/cron/heartbeat', () => ({ withCronRun: (_: string, fn: unknown) => fn }));
vi.mock('@/lib/api/errors', () => ({ serverError: () => Response.json({ error: 'private' }, { status: 500 }) }));
import { GET } from './route';
let rows: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.clearAllMocks(); m.shown = true; m.failed = false; rows = [];
  m.recovery.mockResolvedValue({ attempted: 1, skipped: 0, failed: 0 }); m.resume.mockResolvedValue(undefined);
  m.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q, update: () => q,
      maybeSingle: async () => ({ data: { id: 'wait' } }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: m.failed ? { message: 'private' } : null }).then(resolve) };
    return q;
  });
});
const request = () => new Request('https://riverz.co/api/cron/flows-resume');
describe('flow cron recorded recovery integration', () => {
  it('authenticates before observing or resuming anything', async () => {
    m.auth.mockImplementationOnce(() => { throw new Response(null, { status: 401 }); });
    expect((await GET(request())).status).toBe(401); expect(m.recovery).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
  });
  it('preserves the normal response and wait queue while comparison is hidden', async () => {
    m.shown = false; expect(await (await GET(request())).json()).toEqual({ processed: 0 }); expect(m.recovery).not.toHaveBeenCalled();
  });
  it('recovers recorded responses even with no wait nodes due', async () => {
    expect(await (await GET(request())).json()).toEqual({ processed: 0, httpRecovery: { attempted: 1, skipped: 0, failed: 0 } });
    expect(m.recovery).toHaveBeenCalledOnce();
  });
  it('does not block existing waits after recovery fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.recovery.mockRejectedValue(new Error('secret')); rows = [{ id: 'wait', flow_run_id: 'run', next_node_key: 'next' }];
    expect(await (await GET(request())).json()).toEqual({ processed: 1 });
    expect(m.resume).toHaveBeenCalledExactlyOnceWith({ flowRunId: 'run', nextNodeKey: 'next' });
    expect(logged).toHaveBeenCalledWith('[flows] recorded HTTP recovery unavailable'); logged.mockRestore();
  });
});
