import { beforeEach, expect, it, vi } from 'vitest';
import type { WebhookDeliveryResult } from '@/lib/webhooks/outbound';
const h = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null, role: 'admin', workspace: 'business' as string | null, emit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }));
vi.mock('@/lib/i18n/server', () => ({ safeLocale: async () => 'en' }));
vi.mock('@/lib/instagram-agent/workspace', () => ({ resolveWorkspaceId: async () => h.workspace }));
vi.mock('@/lib/webhooks/outbound', () => ({ emitWebhook: h.emit }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) }, from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: h.role } }) }; return q;
} }) }));
import { POST } from './route';
beforeEach(() => { h.user = { id: 'owner' }; h.role = 'admin'; h.workspace = 'business'; h.emit.mockReset().mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0, unavailable: false }); });
const run = () => POST(new Request('https://riverz.test/api/integrations/webhooks/endpoint/test', { method: 'POST' }), { params: Promise.resolve({ id: 'endpoint' }) });
it.each([
  [{ attempted: 0, succeeded: 0, failed: 0, unavailable: true }, 503],
  [{ attempted: 1, succeeded: 1, failed: 0, unavailable: true }, 503],
  [{ attempted: 0, succeeded: 0, failed: 0, unavailable: false }, 404],
  [{ attempted: 1, succeeded: 0, failed: 1, unavailable: false }, 502],
] as Array<[WebhookDeliveryResult, number]>)('does not claim success for an unconfirmed test', async (result, status) => {
  h.emit.mockResolvedValue(result); const response = await run();
  expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ success: false });
});
it('confirms a recorded acknowledgement and uses the server workspace', async () => {
  const response = await run(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(h.emit).toHaveBeenCalledWith('business', 'conversation.created', { test: true, source: 'riverz', endpoint_id: 'endpoint' }, 'endpoint');
});
it.each(['anonymous', 'member', 'no-workspace'])('does not send an external test for %s', async state => {
  if (state === 'anonymous') h.user = null; if (state === 'member') h.role = 'member'; if (state === 'no-workspace') h.workspace = null;
  expect((await run()).status).toBe(state === 'anonymous' ? 401 : 403); expect(h.emit).not.toHaveBeenCalled();
});
