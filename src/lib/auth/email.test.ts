import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAuthEmail } from './email';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sendAuthEmail', () => {
  it('sends existing-account instructions in both languages without password recovery copy', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{"id":"test"}'));
    vi.stubGlobal('fetch', fetchMock);
    for (const locale of ['es', 'en'] as const) {
      await sendAuthEmail({ to: `${locale}@example.com`, actionLink: 'https://riverz.co/ingresar', locale, kind: 'existing_account' });
      const payload = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
      expect(payload.subject).toBe(locale === 'es' ? 'Ya tienes una cuenta en Riverz' : 'You already have a Riverz account');
      expect(payload.text).toContain(locale === 'es' ? 'contraseña actual' : 'current password');
      expect(payload.text).not.toMatch(/contraseña nueva|new password/);
    }
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key'])
      .not.toBe(fetchMock.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('sends the localized confirmation through Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendAuthEmail({
      to: 'owner@example.com',
      actionLink: 'https://project.supabase.co/auth/v1/verify?token=abc',
      locale: 'es',
      kind: 'confirmation',
    });

    expect(result).toEqual({ ok: true, providerId: 'email_123' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer re_test',
      'Idempotency-Key': expect.stringMatching(/^auth\/confirmation\//),
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: 'Riverz <cuentas@riverz.co>',
      to: ['owner@example.com'],
      subject: 'Confirma tu cuenta de Riverz',
    });
  });

  it('does not claim delivery without a provider key', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    await expect(
      sendAuthEmail({
        to: 'owner@example.com',
        actionLink: 'https://project.supabase.co/auth/v1/verify?token=abc',
        locale: 'en',
        kind: 'confirmation',
      })
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
  });
});
