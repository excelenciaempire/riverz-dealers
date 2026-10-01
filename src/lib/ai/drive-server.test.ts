import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en', auth: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => m.locale }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.auth } }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: m.from, rpc: m.rpc }) }));
import { driveBody, driveFailure, driveRateLimited, driveSession } from './drive-server';
import { translate } from '@/lib/i18n/translate';
const id = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.clearAllMocks(); m.locale = 'es'; m.auth.mockResolvedValue({ data: { user: { id: actor } } }); m.rpc.mockResolvedValue({ data: true, error: null });
  const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: { id, workspace_id: id }, error: null }) }; m.from.mockReturnValue(q);
});
describe('Drive session, bounded requests and bilingual private errors', () => {
  it('binds the assistant to the current authenticated actor', async () => {
    expect(await driveSession(id)).toMatchObject({ workspaceId: id, agentId: id, actorId: actor });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('ai_drive_admin', { p_workspace_id: id, p_actor_id: actor, p_agent_id: id });
  });
  it('does not read an assistant for malformed identity or an absent session', async () => {
    expect(await driveSession('invalid')).toBeNull(); expect(m.auth).not.toHaveBeenCalled();
    m.auth.mockResolvedValue({ data: { user: null } }); expect(await driveSession(id)).toBeNull(); expect(m.from).not.toHaveBeenCalled();
  });
  it('fails closed on revoked permissions and database errors', async () => {
    m.rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: true, error: { message: 'private' } });
    expect(await driveSession(id)).toBeNull(); expect(await driveSession(id)).toBeNull();
  });
  it('bounds streamed UTF-8 input rather than trusting content-length', async () => {
    expect(await driveBody(new Request('https://riverz.co', { method: 'POST', body: 'Café' }))).toBe('Café');
    await expect(driveBody(new Request('https://riverz.co', { method: 'POST', body: 'é'.repeat(2049) }))).rejects.toThrow('document_invalid');
    await expect(driveBody(new Request('https://riverz.co', { method: 'POST', body: new Uint8Array([255]) }))).rejects.toThrow('document_invalid');
  });
  it.each(['es','en'] as const)('localizes provider and unknown private errors in %s', async locale => {
    m.locale = locale;
    for (const code of ['drive_denied','drive_unsupported','document_changed']) {
      const response = await driveFailure({ message: code }); expect((await response.json()).error).toBe(translate(locale, 'assistant.' + code));
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    const response = await driveFailure({ message: 'SQL password secret' }); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: translate(locale, 'assistant.drive_unavailable') });
    const limited = await driveRateLimited(Date.now() + 2000); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(await limited.json()).toEqual({ error: translate(locale, 'assistant.driveRateLimit') });
  });
});
