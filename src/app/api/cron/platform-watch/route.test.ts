import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  previous: '', readError: false, saveError: false, won: true,
  healthError: false, confirmationError: false,
  latest: 'error', completed: 'error',
  saved: [] as Array<{ fingerprint: string }>,
  collect: vi.fn(), providers: vi.fn(), send: vi.fn(),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: vi.fn() }));
vi.mock('@/lib/cron/heartbeat', () => ({ withCronRun: (_: string, handler: unknown) => handler }));
vi.mock('@/lib/health/issues', () => ({ collectPlatformIssues: m.collect }));
vi.mock('@/lib/admin/proveedores', () => ({ leerProveedores: m.providers }));
vi.mock('@/lib/admin/platform-whatsapp', () => ({
  platformTechnicalAlertRecipients: async () => ({ phone: 'test', email: null }),
  sendPlatformAlert: m.send,
}));
vi.mock('@/lib/cron/schedule', () => ({
  SCHEDULED_JOBS: [{ name: 'instagram-external-enrich' }, { name: 'healthy' }],
  isStale: () => false,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async () => ({
      data: [{ name: 'instagram-external-enrich', status: m.latest }],
      error: m.healthError ? { message: 'timeout' } : null,
    }),
    from(table: string) {
      let writing = false;
      const chain: Record<string, unknown> = {};
      const result = () => {
        if (table === 'platform_watch_state') return writing
          ? { data: m.won ? [{ id: true }] : [], error: m.saveError ? { message: 'write timeout' } : null }
          : { data: { fingerprint: m.previous }, error: m.readError ? { message: 'read timeout' } : null };
        if (table === 'cron_runs') return {
          data: [{ status: m.completed, started_at: new Date().toISOString() },
            { status: m.completed, started_at: new Date(Date.now() - 60_000).toISOString() }],
          error: m.confirmationError ? { message: 'confirmation timeout' } : null,
        };
        return { data: [], error: null };
      };
      for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit']) chain[method] = () => chain;
      for (const method of ['update', 'insert', 'upsert']) chain[method] = (body: { fingerprint: string }) => {
        writing = true;
        if (table === 'platform_watch_state') m.saved.push(body);
        return chain;
      };
      chain.maybeSingle = async () => result();
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
      return chain;
    },
  }),
}));

import { GET } from './route';
const request = () => new Request('https://riverzai.com/api/cron/platform-watch');
const incident = 'cron:instagram-external-enrich';

describe('platform incident continuity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(m, { previous: incident, readError: false, saveError: false,
      won: true, healthError: false, confirmationError: false,
      latest: 'error', completed: 'error', saved: [] });
    m.collect.mockResolvedValue(new Map());
    m.providers.mockResolvedValue({ proveedores: [] });
    m.send.mockResolvedValue({ ok: true });
  });

  it('does not forget or reannounce an incident when cron health is unreadable', async () => {
    m.healthError = true;
    expect((await GET(request())).status).toBe(207);
    expect(m.saved).toHaveLength(0);
    m.healthError = false;
    expect((await GET(request())).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
  });

  it('preserves an incident when its confirmation query fails', async () => {
    m.confirmationError = true;
    expect((await GET(request())).status).toBe(207);
    expect(m.saved).toHaveLength(0);
    expect(m.send).not.toHaveBeenCalled();
  });

  it('still evaluates crons during a workspace-health timeout and keeps channel incidents', async () => {
    m.previous = 'canal:workspace:connection_error:shop';
    m.collect.mockRejectedValue(new Error('statement timeout'));
    expect((await GET(request())).status).toBe(207);
    expect(m.saved[0].fingerprint).toContain(m.previous);
    expect(m.saved[0].fingerprint).toContain(incident);
    expect(m.send).toHaveBeenCalledOnce();
  });

  it('does not treat running as recovery, but clears after a completed success', async () => {
    m.latest = 'running';
    await GET(request());
    expect(m.saved).toHaveLength(0);
    m.completed = 'ok';
    await GET(request());
    expect(m.saved[0].fingerprint).toBe('');
    expect(m.send).not.toHaveBeenCalled();
  });

  it('fails closed when deduplication state cannot be read or saved', async () => {
    m.readError = true;
    await expect(GET(request())).rejects.toThrow('read timeout');
    m.readError = false;
    m.previous = '';
    m.saveError = true;
    await expect(GET(request())).rejects.toThrow('write timeout');
    expect(m.send).not.toHaveBeenCalled();
  });

  it('only the monitor that saves the new fingerprint sends the alert', async () => {
    m.previous = '';
    m.won = false;
    await GET(request());
    expect(m.send).not.toHaveBeenCalled();
  });
});
