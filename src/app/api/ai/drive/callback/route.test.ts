import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ shown: true, rpc: vi.fn(), auth: vi.fn(), cookie: 'b'.repeat(64), cookies: vi.fn(), remove: vi.fn(), exchange: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return m.shown; } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.auth } }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/channels/encryption', () => ({ decrypt: () => 'a'.repeat(43), encrypt: () => 'encrypted-secret-token' }));
vi.mock('next/headers', () => ({ cookies: m.cookies }));
vi.mock('@/lib/ai/drive-provider', () => ({ exchangeDriveCode: m.exchange, DriveProviderError: class extends Error {} }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/base-url', () => ({ publicBaseUrl: () => 'https://riverz.co' }));
import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.clearAllMocks(); m.shown = true; m.cookie = 'b'.repeat(64);
  m.cookies.mockResolvedValue({ get: () => ({ value: m.cookie }), delete: m.remove });
  m.auth.mockResolvedValue({ data: { user: { id } } });
  m.rpc.mockImplementation(async (name: string) => ({ data: name === 'consume_ai_drive_oauth' ? { workspace_id: id, agent_id: id, verifier_ciphertext: 'encrypted-verifier' } : true, error: null }));
  m.exchange.mockResolvedValue({ account_id: 'google-account', email: 'owner@example.com', access_token: 'secret-access', refresh_token: 'secret-refresh' });
});
const request = (query = `state=${'a'.repeat(64)}&code=google-code`) => new Request('https://riverz.co/api/ai/drive/callback?' + query);
describe('Drive callback requires current authenticated browser-bound consent', () => {
  it('does not process authorization while UI comparison is hidden', async () => {
    m.shown = false; expect((await GET(request())).status).toBe(404); expect(m.auth).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each(['', `state=${'a'.repeat(64)}&code=code&state=${'a'.repeat(64)}`, `state=${'a'.repeat(64)}&error=access_denied`])('rejects malformed or denied OAuth returns', async query => {
    expect((await GET(request(query))).status).toBe(422); expect(m.rpc).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled();
  });
  it('never substitutes an unsigned actor when the session is absent', async () => {
    m.auth.mockResolvedValue({ data: { user: null } }); expect((await GET(request())).status).toBe(404); expect(m.rpc).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled();
  });
  it('exchanges only after state consumption with current actor and cookie hash', async () => {
    const result = await GET(request()); expect(result.status).toBe(307); expect(result.headers.get('location')).toContain('/ai?agent=' + id);
    expect(m.rpc.mock.calls[0]).toEqual(['consume_ai_drive_oauth', expect.objectContaining({ p_actor_id: id, p_cookie_hash: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(m.exchange).toHaveBeenCalledExactlyOnceWith({ code: 'google-code', verifier: 'a'.repeat(43), redirectUri: 'https://riverz.co/api/ai/drive/callback' });
    expect(m.rpc.mock.calls[1][1]).toMatchObject({ p_actor_id: id, p_account_id: 'google-account', p_credential_ciphertext: 'encrypted-secret-token' });
    expect(JSON.stringify([...result.headers])).not.toContain('secret-access'); expect(m.remove).toHaveBeenCalledOnce();
  });
  it('does not exchange a consumed, mismatched or expired consent', async () => {
    m.rpc.mockResolvedValue({ error: { message: 'invalid_document_context' } }); expect((await GET(request())).status).toBe(404); expect(m.exchange).not.toHaveBeenCalled();
  });
  it('does not redirect or claim connection after storage fails', async () => {
    m.rpc.mockImplementation(async (name: string) => ({ data: name === 'consume_ai_drive_oauth' ? { workspace_id: id, agent_id: id, verifier_ciphertext: 'encrypted-verifier' } : null,
      error: name === 'connect_ai_drive' ? { message: 'SQL password secret' } : null }));
    const result = await GET(request()); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain('password'); expect(m.remove).not.toHaveBeenCalled();
  });
});
