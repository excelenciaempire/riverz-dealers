import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), memberships: vi.fn(), media: vi.fn(), scope: vi.fn(), info: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'synthetic-token' }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: mocks.info }));
vi.mock('@/lib/whatsapp/media-download', () => ({ downloadMedia: mocks.download }));
vi.mock('@/lib/channels/media-ingest', () => ({ resolveMime: () => 'image/png' }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, limit: () => chain,
    in: (key: string, values: string[]) => { mocks.scope(table, key, values); return chain; },
    maybeSingle: async () => table === 'messages' ? mocks.media() : { data: { access_token: 'encrypted-fixture' } },
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        table === 'whatsapp_config' ? { data: [{ access_token: 'encrypted-fixture' }], error: null } : mocks.memberships(),
      ).then(resolve),
  };
  return chain;
} }) }));
import { GET } from './route';
const call = (mediaId = '12345678') => GET(new Request('https://riverz.test/api/whatsapp/media/12345678'), { params: Promise.resolve({ mediaId }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: 'caller' } }, error: null });
  mocks.memberships.mockReturnValue({ data: [{ workspace_id: 'allowed-workspace' }], error: null });
  mocks.media.mockReturnValue({ data: { id: 'allowed-message' }, error: null });
  mocks.info.mockResolvedValue({ url: 'https://cdn.test/photo', mimeType: 'image/png' });
  mocks.download.mockResolvedValue({ buffer: Buffer.from('image'), contentType: 'image/png' });
});
it('serves a historical attachment only after checking its conversation scope', async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(mocks.scope).toHaveBeenCalledWith('messages', 'conversations.workspace_id', ['allowed-workspace']);
  expect(mocks.info).toHaveBeenCalledWith({ mediaId: '12345678', accessToken: 'synthetic-token' });
});
it('does not contact Meta for an ID absent from the caller conversations', async () => {
  mocks.media.mockReturnValue({ data: null, error: null });
  expect((await call()).status).toBe(404);
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
});
it('fails closed when membership lookup fails', async () => {
  mocks.memberships.mockReturnValue({ data: null, error: { code: 'unavailable' } });
  expect((await call()).status).toBe(404);
  expect(mocks.info).not.toHaveBeenCalled();
});
it('requires an authenticated session', async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  expect((await call()).status).toBe(401);
  expect(mocks.info).not.toHaveBeenCalled();
});
it('rejects IDs that could change the Graph API path', async () => {
  expect((await call('../me?fields=accounts')).status).toBe(400);
  expect(mocks.info).not.toHaveBeenCalled();
});
