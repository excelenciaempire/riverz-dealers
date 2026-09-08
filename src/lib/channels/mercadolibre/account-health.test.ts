import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInactiveMLAccountError, recordInactiveMLAccount } from './account-health';

afterEach(() => vi.unstubAllGlobals());
function database() {
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  return { update, db: { from: () => ({ update }) } };
}
describe('ML account health', () => {
  it('records the confirmed account problem in both languages', async () => {
    for (const locale of ['es', 'en'] as const) {
      const { db, update } = database();
      const message = await recordInactiveMLAccount(db as never, 'connection', 'token', 403, 'user is not active', locale);
      expect(message).toContain(locale === 'es' ? 'inactiva' : 'inactive');
      expect(isInactiveMLAccountError(message)).toBe(true);
      expect(update).toHaveBeenCalledWith({ status: 'error', last_error: message });
    }
  });
  it('does not retain unrelated connection failures after a token renewal', () => {
    expect(isInactiveMLAccountError(null)).toBe(false);
    expect(isInactiveMLAccountError('token expired')).toBe(false);
  });
  it('does not label a resource permission denial as an inactive account', async () => {
    const { db, update } = database();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(await recordInactiveMLAccount(db as never, 'connection', 'token', 403, 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', 'es')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it('confirms generic policy failures before marking the connection', async () => {
    const { db, update } = database();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"user is not active"}', { status: 403 })));
    await recordInactiveMLAccount(db as never, 'connection', 'token', 403, 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', 'en');
    expect(update).toHaveBeenCalledOnce();
  });
});
