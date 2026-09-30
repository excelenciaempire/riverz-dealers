import { beforeEach, describe, expect, it, vi } from 'vitest';
import { creditKeyDigest } from '@/lib/admin/provider-credit';
import type { FundingSnapshot } from '@/lib/admin/funding';

const m = vi.hoisted(() => ({
  previous: '', history:{} as Record<string,string>, readError: false, saveError: false, won: true,
  healthError: false, confirmationError: false,
  latest: 'error', completed: 'error',
  saved: [] as Array<{ fingerprint: string }>,
  collect: vi.fn(), providers: vi.fn(), send: vi.fn(),
  funding: null as FundingSnapshot | null, fundingError: false,
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: vi.fn() }));
vi.mock('@/lib/cron/heartbeat', () => ({ withCronRun: (_: string, handler: unknown) => handler }));
vi.mock('@/lib/health/issues', () => ({ collectPlatformIssues: m.collect }));
vi.mock('@/lib/admin/proveedores', () => ({ leerProveedores: m.providers, claveParaSaldo: async () => 'synthetic-platform-key' }));
vi.mock('@/lib/admin/platform-whatsapp', () => ({
  platformTechnicalAlertRecipients: async () => ({ phone: 'test', email: null }),
  platformWhatsAppStatus: async () => ({ templateLanguage: 'es', templateName: 'riverz_aviso' }),
  sendPlatformAlert: m.send,
}));
vi.mock('@/lib/cron/schedule', () => ({
  SCHEDULED_JOBS: [{ name: 'instagram-external-enrich' }, { name: 'healthy' }],
  isStale: () => false,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string) => name === 'claim_platform_watch_notifications' ? {
      data: m.won ? [{ fingerprint: m.previous, alert_history: m.history, pending_notifications: [], notification_lease_id: 'lease' }] : [],
      error: m.readError ? { message: 'read timeout' } : null,
    } : name === 'release_platform_watch_notifications' ? { data: null, error: null } :
      name === 'admin_funding_snapshot' ? { data: m.funding, error: m.fundingError ? {message:'timeout'} : null } : ({
      data: [{ name: 'instagram-external-enrich', status: m.latest }],
      error: m.healthError ? { message: 'timeout' } : null,
    }),
    from(table: string) {
      let writing = false;
      const chain: Record<string, unknown> = {};
      const result = () => {
        if (table === 'platform_watch_state') return writing
          ? { data: m.won ? [{ id: true }] : [], error: m.saveError ? { message: 'write timeout' } : null }
          : { data: { fingerprint: m.previous, alert_history:m.history }, error: m.readError ? { message: 'read timeout' } : null };
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
      latest: 'error', completed: 'error', saved: [], history:{} });
    m.fundingError = false;
    m.funding = {wallets:[],manual:[],usage:[],measured_at:new Date().toISOString()};
    m.collect.mockResolvedValue(new Map());
    m.providers.mockResolvedValue({ proveedores: [] });
    m.send.mockResolvedValue({ ok: true, messageId: 'wamid.test' });
  });

  it('does not forget or reannounce an incident when cron health is unreadable', async () => {
    m.healthError = true;
    expect((await GET(request())).status).toBe(207);
    expect(m.saved).toHaveLength(0);
    m.healthError = false;
    expect((await GET(request())).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('sends a below-$3 Anthropic warning once per funding episode to the configured admin', async () => {
    m.previous = ''; m.latest = 'ok';
    m.funding!.wallets = [{currency:'USD',accounts:1,balance_cents:4400,reserved_cents:0,available_cents:4400}];
    m.funding!.manual = [{provider:'anthropic',balance_usd:11.94,spent_since_usd:9.5,
      confirmed_at:new Date(Date.now()-3600000).toISOString(),key_digest:creditKeyDigest('synthetic-platform-key')}];
    const response = await GET(request());
    expect(await response.json()).toMatchObject({anthropicLowBalance:{topUpUsd:42}});
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({to:'test',body:expect.stringContaining('Anthropic: saldo estimado')}));
    m.previous = m.saved.at(-1)!.fingerprint;
    m.send.mockClear();
    await GET(request());
    expect(m.send).not.toHaveBeenCalled();
    m.funding!.manual[0].confirmed_at = new Date().toISOString();
    m.previous = '';
    await GET(request());
    expect(m.send).toHaveBeenCalledOnce();
  });
  it('preserves pending Anthropic warnings when the funding read fails without inventing a new balance', async () => {
    m.latest = 'ok'; m.previous = 'saldo:anthropic:menos_3:existing'; m.fundingError = true;
    const response = await GET(request());
    expect(response.status).toBe(207);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.saved).toHaveLength(0);
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
    await expect(GET(request())).rejects.toThrow('platform_notification_snapshot_failed');
    expect(m.send).not.toHaveBeenCalled();
  });

  it('only the monitor that saves the new fingerprint sends the alert', async () => {
    m.previous = '';
    m.won = false;
    await GET(request());
    expect(m.send).not.toHaveBeenCalled();
  });

  it('keeps connection incidents stable when SQL reverses their update order', async () => {
    m.latest = 'ok';
    m.previous = 'canal:workspace:connection_error:ig_comment|canal:workspace:connection_error:mercadolibre';
    for (const detail of ['ig_comment, mercadolibre', 'mercadolibre, ig_comment']) {
      m.collect.mockResolvedValue(new Map([['workspace', [{ kind: 'connection_error', detail, refId: detail.split(',')[0] }]]]));
      await GET(request());
    }
    expect(m.saved).toHaveLength(0);
    expect(m.send).not.toHaveBeenCalled();
  });

  it('reports only the new connection instead of repeating the existing one', async () => {
    m.latest = 'ok';
    m.previous = 'canal:workspace:connection_error:mercadolibre';
    m.collect.mockResolvedValue(new Map([['workspace', [{ kind: 'connection_error', detail: 'ig_comment, mercadolibre', refId: 'ig_comment' }]]]));
    await GET(request());
    expect(m.send).not.toHaveBeenCalled();
    m.previous = m.saved[0].fingerprint;
    await GET(request());
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ body: '· Conexión con error: ig_comment' }));
    expect(m.saved[1].fingerprint).toContain('canal:workspace:connection_error:mercadolibre');
    expect(m.saved[1].fingerprint).not.toContain('~');
  });

  it('does not announce a connection error that clears by the next tick', async () => {
    m.latest = 'ok';
    m.previous = '';
    m.collect.mockResolvedValue(new Map([['workspace', [{ kind: 'connection_error', detail: 'ig_comment', refId: 'ig_comment' }]]]));
    await GET(request());
    m.previous = m.saved[0].fingerprint;
    m.collect.mockResolvedValue(new Map());
    await GET(request());
    expect(m.send).not.toHaveBeenCalled();
    expect(m.saved[1].fingerprint).toBe('');
  });
  it('does not reannounce the same transient job failure after a short recovery',async()=>{
    m.previous='';m.history={[incident]:new Date(Date.now()-3600000).toISOString()};
    await GET(request());expect(m.send).not.toHaveBeenCalled();
    expect(m.saved[0].fingerprint).toContain(incident);
  });
  it('keeps missing shipment labels in logistics, not platform-outage WhatsApps',async()=>{
    m.previous='';m.latest='ok';
    m.collect.mockResolvedValue(new Map(['a','b','c'].map(id=>[id,[{kind:'tracking_missing',count:10}]])));
    await GET(request());expect(m.send).not.toHaveBeenCalled();
  });
});
