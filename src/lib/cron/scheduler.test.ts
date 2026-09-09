import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), due: vi.fn(), log: vi.fn() }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/claves', () => ({ hidratarClaves: async () => {} }));
vi.mock('@/lib/log/logger', () => ({ getLogger: () => ({ info: mocks.log, warn: mocks.log, error: mocks.log }) }));
vi.mock('./schedule', () => ({
  DEFAULT_TIMEOUT_MS: 1000, SCHEDULED_JOBS: [], dueJobs: mocks.due,
  expectedIntervalMs: () => 60000, isStale: () => false,
}));
import { startScheduler, stopScheduler } from './scheduler';
const job = { name: 'test-sync', path: '/test-sync', schedule: '* * * * *' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
  delete (globalThis as Record<string, unknown>).__riverzScheduler;
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'test');
  vi.stubEnv('SCHEDULER_DISABLED', 'false');
  vi.stubEnv('NEXT_PHASE', 'test');
  mocks.due.mockReturnValue([job]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
});
afterEach(() => {
  stopScheduler(); vi.clearAllTimers(); vi.useRealTimers();
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
describe('autonomous scheduler recovery', () => {
  it.each([null, false])('does not dispatch without an explicit claim (%s)', async data => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) });
    startScheduler(); await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retries next minute after coordination failure without human intervention', async () => {
    let available = false;
    const signals: AbortSignal[] = [];
    mocks.rpc.mockImplementation((name: string) => ({ abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(available
        ? { data: name === 'claim_scheduler_tick' ? true : [], error: null }
        : { data: null, error: { message: 'database unavailable' } });
    } }));
    startScheduler(); await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).not.toHaveBeenCalled();
    available = true;
    await vi.advanceTimersByTimeAsync(55000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true);
  });
  it('keeps the clock alive after an unexpected asynchronous tick failure', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: true, error: null }) });
    mocks.due.mockImplementationOnce(() => { throw new Error('unexpected'); }).mockReturnValue([job]);
    startScheduler(); await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(55000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
