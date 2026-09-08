import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';

export type AuthEmailKind = 'confirmation' | 'recovery' | 'existing_account';

type SendAuthEmailInput = {
  to: string;
  actionLink: string;
  locale: Locale;
  kind: AuthEmailKind;
};

export type SendAuthEmailResult =
  | { ok: true; providerId: string | null }
  | {
      ok: false;
      reason: 'not_configured' | 'provider_rejected' | 'network_error';
    };

export function authEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const COPY_KEYS: Record<
  AuthEmailKind,
  { subject: string; title: string; body: string; button: string }
> = {
  existing_account: {
    subject: 'auth.existingAccountEmailSubject',
    title: 'auth.existingAccountEmailTitle',
    body: 'auth.existingAccountEmailBody',
    button: 'auth.signIn',
  },
  confirmation: {
    subject: 'auth.confirmationEmailSubject',
    title: 'auth.confirmationEmailTitle',
    body: 'auth.confirmationEmailBody',
    button: 'auth.confirmationEmailButton',
  },
  recovery: {
    subject: 'auth.recoveryEmailSubject',
    title: 'auth.recoveryEmailTitle',
    body: 'auth.recoveryEmailBody',
    button: 'auth.recoveryEmailButton',
  },
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char
  );
}

/**
 * Envía los enlaces de Auth por Resend desde el dominio verificado de Riverz.
 * Supabase sólo genera y valida el token; no usamos su SMTP compartido, que no
 * entrega a usuarios externos y limita el proyecto a dos mensajes por hora.
 */
export async function sendAuthEmail({
  to,
  actionLink,
  locale,
  kind,
}: SendAuthEmailInput): Promise<SendAuthEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      JSON.stringify({ scope: 'auth-email', event: 'provider_not_configured' })
    );
    return { ok: false, reason: 'not_configured' };
  }

  let link: URL;
  try {
    link = new URL(actionLink);
    if (link.protocol !== 'https:' && link.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    console.error(
      JSON.stringify({ scope: 'auth-email', event: 'invalid_link' })
    );
    return { ok: false, reason: 'provider_rejected' };
  }

  const keys = COPY_KEYS[kind];
  const subject = translate(locale, keys.subject);
  const title = translate(locale, keys.title);
  const body = translate(locale, keys.body);
  const button = translate(locale, keys.button);
  const footer = translate(locale, 'auth.authEmailFooter');
  const safeLink = escapeHtml(link.toString());
  const idempotencyKey = `auth/${kind}/${createHash('sha256')
    // Informational emails share a login URL; each request needs its own key.
    // Token emails still deduplicate retries of the same recipient/link.
    .update(`${to.toLowerCase()}\n${locale}\n${link.toString()}${kind === 'existing_account' ? randomUUID() : ''}`)
    .digest('hex')}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM || 'Riverz <cuentas@riverz.co>',
        to: [to],
        subject,
        text: `${title}\n\n${body}\n\n${button}: ${link.toString()}\n\n${footer}`,
        html:
          '<div style="background:#f7f6f0;padding:32px 16px;font-family:Arial,sans-serif;color:#171712">' +
          '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e1d5;border-radius:16px;padding:32px">' +
          '<div style="font-size:24px;font-weight:700;letter-spacing:.04em;margin-bottom:28px">riverz</div>' +
          `<h1 style="font-size:24px;line-height:1.25;margin:0 0 12px">${escapeHtml(title)}</h1>` +
          `<p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#57564f">${escapeHtml(body)}</p>` +
          `<a href="${safeLink}" style="display:inline-block;background:#777d16;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(button)}</a>` +
          `<p style="font-size:12px;line-height:1.5;margin:28px 0 0;color:#85847d">${escapeHtml(footer)}</p>` +
          '</div></div>',
      }),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          scope: 'auth-email',
          event: 'provider_rejected',
          status: response.status,
        })
      );
      return { ok: false, reason: 'provider_rejected' };
    }

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;
    return { ok: true, providerId: payload?.id ?? null };
  } catch {
    console.error(
      JSON.stringify({ scope: 'auth-email', event: 'network_error' })
    );
    return { ok: false, reason: 'network_error' };
  }
}
