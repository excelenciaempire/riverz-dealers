import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), sync: vi.fn(), marker: {} }));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: m.auth }));
vi.mock('@/lib/cron/heartbeat', () => ({ withCronRun: (_name: string, handler: unknown) => handler }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: m.db }));
vi.mock('@/lib/ai/drive-sync', () => ({ syncDriveDocuments: m.sync }));
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); m.db.mockReturnValue(m.marker); m.sync.mockResolvedValue({ imported: 1, failed: 0, superseded: 0 }); });
describe('Drive cron authentication and failures', () => {
  it('rejects unauthorized calls before accessing service data', async () => {
    m.auth.mockImplementationOnce(() => { throw new Response(null, { status: 401 }); });
    expect((await GET(new Request('https://riverz.co/api/cron/drive-documents'))).status).toBe(401);
    expect(m.db).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled();
  });
  it('returns bounded worker outcomes to the authenticated scheduler', async () => {
    const response = await GET(new Request('https://riverz.co/api/cron/drive-documents'));
    expect(await response.json()).toEqual({ imported: 1, failed: 0, superseded: 0 }); expect(m.sync).toHaveBeenCalledExactlyOnceWith(m.marker);
    expect(m.auth).toHaveBeenCalledExactlyOnceWith(expect.any(Request), 'AUTOMATION_CRON_SECRET');
  });
  it('never reports a private worker failure as a successful run', async () => {
    m.sync.mockRejectedValueOnce(new Error('secret credential')); const response = await GET(new Request('https://riverz.co/api/cron/drive-documents'));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'drive_sync_unavailable' });
  });
});
