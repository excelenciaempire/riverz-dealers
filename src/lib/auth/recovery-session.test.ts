import { describe, expect, it, vi } from 'vitest';
import { restoreRecoverySession } from './recovery-session';

function auth(session = true) {
  return {
    getSession: vi.fn(async () => ({ data: { session: session ? {} : null } })),
    setSession: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ error: null })),
  };
}

describe('restoreRecoverySession', () => {
  it('stores an implicit recovery session from the URL fragment', async () => {
    const client = auth();
    await expect(restoreRecoverySession(client, 'https://riverz.co/nueva-clave#access_token=a&refresh_token=r&type=recovery')).resolves.toBe(true);
    expect(client.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });

  it('exchanges a recovery code from the query string', async () => {
    const client = auth();
    await restoreRecoverySession(client, 'https://riverz.co/nueva-clave?code=abc');
    expect(client.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('verifies a recovery token hash', async () => {
    const client = auth();
    await restoreRecoverySession(client, 'https://riverz.co/nueva-clave?token_hash=abc&type=recovery');
    expect(client.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' });
  });

  it('rejects a link whose session cannot be established', async () => {
    const client = auth(false);
    await expect(restoreRecoverySession(client, 'https://riverz.co/nueva-clave')).resolves.toBe(false);
  });
});
