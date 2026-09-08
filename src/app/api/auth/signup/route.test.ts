import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  generateLink: vi.fn(), reset: vi.fn(), send: vi.fn(), release: vi.fn(), redeem: vi.fn(),
  locale: 'es',
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({
  auth: { admin: { generateLink: m.generateLink }, resetPasswordForEmail: m.reset },
}) }));
vi.mock('@/lib/auth/email', () => ({ sendAuthEmail: m.send }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => m.locale }));
vi.mock('@/lib/auth/signups', () => ({ signupsOpen: () => true }));
vi.mock('@/lib/legal/consent', () => ({ recordLegalConsent: vi.fn() }));
vi.mock('@/lib/shopify/pending-install', () => ({ pendingInstallExists: vi.fn(), CLAIM_COOKIE: 'claim' }));
vi.mock('@/lib/auth/signup-codes', () => ({
  claimSignupCode: async () => 'code-id', releaseSignupCode: m.release, recordSignupCodeRedemption: m.redeem,
}));

import { POST } from './route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
const collision = { data: {}, error: { code: 'email_exists' } };
const signup = { data: { user: { id: 'new-user' }, properties: { action_link: 'https://auth.example/verify?token=test' } }, error: null };
function request(next = '/panel') {
  return new Request('https://riverz.co/api/auth/signup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'sample-password', accept_terms: true,
      invite_code: 'CODE', redirect_to: `https://riverz.co/auth/callback?next=${encodeURIComponent(next)}` }),
  });
}
beforeEach(() => {
  vi.clearAllMocks(); __resetRateLimitForTests();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://riverz.co');
  m.locale = 'es';
  m.generateLink.mockResolvedValue(collision);
  m.send.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('signup email intent', () => {
  it('informs an existing account owner without generating or sending a recovery link', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(m.generateLink).toHaveBeenCalledOnce();
    expect(m.generateLink.mock.calls[0][0].type).toBe('signup');
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'existing_account',
      actionLink: 'https://riverz.co/ingresar?next=%2Fpanel' }));
    expect(m.reset).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledOnce();
    expect(m.redeem).not.toHaveBeenCalled();
  });
  it('sends confirmation for a new account while keeping the public response identical', async () => {
    const existingResponse = await (await POST(request())).json();
    m.generateLink.mockResolvedValue(signup);
    const newResponse = await (await POST(request())).json();
    expect(newResponse).toEqual(existingResponse);
    expect(m.send).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'confirmation', actionLink: signup.data.properties.action_link }));
    expect(m.redeem).toHaveBeenCalledOnce();
  });
  it('keeps the English sign-in route and invitation destination', async () => {
    m.locale = 'en';
    await POST(request('/invitacion/example'));
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en',
      actionLink: 'https://riverz.co/login?next=%2Finvitacion%2Fexample' }));
  });
  it('rejects an external return destination', async () => {
    await POST(request('https://attacker.example'));
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ actionLink: 'https://riverz.co/ingresar' }));
  });
  it('does not fall back to an unsolicited reset when delivery is unavailable', async () => {
    m.send.mockResolvedValue({ ok: false, reason: 'not_configured' });
    expect((await POST(request())).status).toBe(503);
    expect(m.reset).not.toHaveBeenCalled();
  });
});
