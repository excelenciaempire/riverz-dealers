import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@/lib/instagram-agent/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: vi.fn(async () => 'es') }));
vi.mock('@/lib/integrations/logistics-read', () => ({ readLogisticsReview: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { readLogisticsReview } from '@/lib/integrations/logistics-read';
import { GET } from './route';
const request = new Request('https://example.com/api/integrations/dropi/preview?workspace_id=foreign');
describe('logistics preview authorization', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  function session(id: string | null) {
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) } } as never);
  }
  it('does not read orders without authentication', async () => {
    session(null);
    expect((await GET(request)).status).toBe(401);
    expect(readLogisticsReview).not.toHaveBeenCalled();
  });
  it('does not accept a caller supplied foreign workspace', async () => {
    session('user');
    vi.mocked(resolveWorkspaceId).mockResolvedValue(null);
    expect((await GET(request)).status).toBe(404);
    expect(readLogisticsReview).not.toHaveBeenCalled();
  });
  it('reads only the authenticated membership workspace and prevents caching', async () => {
    session('user');
    vi.mocked(resolveWorkspaceId).mockResolvedValue('own');
    vi.mocked(readLogisticsReview).mockResolvedValue({ mode: 'draft', executable: false, orders: [] } as never);
    const response = await GET(request);
    expect(readLogisticsReview).toHaveBeenCalledWith(expect.anything(), 'own', 'es', undefined);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ executable: false });
  });
});
