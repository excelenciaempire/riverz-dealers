import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resetPasswordForEmail,
  generateLink,
  sendAuthEmail,
  authEmailConfigured,
} = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  generateLink: vi.fn(),
  sendAuthEmail: vi.fn(),
  authEmailConfigured: vi.fn(),
}));

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    auth: {
      resetPasswordForEmail,
      admin: { generateLink },
    },
  }),
}));

vi.mock('@/lib/auth/email', () => ({
  authEmailConfigured,
  sendAuthEmail,
}));

vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));

import { POST } from './route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

function recoveryRequest(
  email = 'owner@example.com',
  redirectTo = 'https://riverz.co/nueva-clave',
) {
  return new Request('https://riverz.co/api/auth/reset-password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.20',
    },
    body: JSON.stringify({
      email,
      redirect_to: redirectTo,
    }),
  });
}

beforeEach(() => {
  __resetRateLimitForTests();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://riverz.co');
  authEmailConfigured.mockReturnValue(false);
  resetPasswordForEmail.mockResolvedValue({ error: null });
  generateLink.mockReset();
  sendAuthEmail.mockReset();
});

afterEach(() => {
  __resetRateLimitForTests();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/auth/reset-password', () => {
  it('uses Supabase email delivery when Resend is unavailable', async () => {
    const response = await POST(recoveryRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: 'Si la cuenta existe, recibirás un correo con instrucciones.',
    });
    expect(resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
      redirectTo: 'https://riverz.co/nueva-clave',
    });
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendAuthEmail).not.toHaveBeenCalled();
  });

  it('uses the configured Riverz password page when the request comes from localhost', async () => {
    const response = await POST(
      recoveryRequest(
        'owner@example.com',
        'http://localhost:10000/nueva-clave',
      ),
    );

    expect(response.status).toBe(200);
    expect(resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
      redirectTo: 'https://riverz.co/nueva-clave',
    });
  });

  it('uses the configured Riverz password page for Resend recovery links', async () => {
    authEmailConfigured.mockReturnValue(true);
    generateLink.mockResolvedValue({
      data: { properties: { action_link: 'https://auth.example/recovery' } },
      error: null,
    });
    sendAuthEmail.mockResolvedValue({ ok: true });

    const response = await POST(
      recoveryRequest(
        'owner@example.com',
        'http://localhost:10000/nueva-clave',
      ),
    );

    expect(response.status).toBe(200);
    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'owner@example.com',
      options: {
        redirectTo: 'https://riverz.co/nueva-clave',
      },
    });
  });

  it('does not claim delivery when Supabase rejects the fallback', async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { code: 'email_provider_disabled' },
    });

    const response = await POST(recoveryRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'No pudimos enviar el correo. Inténtalo de nuevo.',
    });
  });
});
