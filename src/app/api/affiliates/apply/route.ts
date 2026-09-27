import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { clientIp, limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const ALLOWED_HOSTS = new Set(['riverz.co', 'www.riverz.co']);

function sameOrigin(request: Request): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return (
      ALLOWED_HOSTS.has(originHost) ||
      originHost === request.headers.get('host')
    );
  } catch {
    return false;
  }
}

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

function referralCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export async function POST(request: Request) {
  const locale = await getLocale();
  if (!sameOrigin(request))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const rate = await limitByKey(`affiliate-apply:${clientIp(request)}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.success) return rateLimitResponse(rate);

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    email?: string;
    website?: string;
    audience?: string;
    promotionPlan?: string;
    payoutEmail?: string;
    company?: string;
  } | null;
  if (body?.company) return NextResponse.json({ ok: true });

  const name = body?.name?.trim().slice(0, 120) ?? '';
  const email = body?.email?.trim().toLowerCase().slice(0, 254) ?? '';
  const website = body?.website?.trim().slice(0, 300) || null;
  const audience = body?.audience?.trim().slice(0, 120) ?? '';
  const promotionPlan = body?.promotionPlan?.trim().slice(0, 1000) ?? '';
  const payoutEmail =
    body?.payoutEmail?.trim().toLowerCase().slice(0, 254) || email;
  if (
    name.length < 2 ||
    !EMAIL_RE.test(email) ||
    audience.length < 2 ||
    promotionPlan.length < 10 ||
    !EMAIL_RE.test(payoutEmail) ||
    (website && !URL_RE.test(website))
  ) {
    return NextResponse.json(
      { error: translate(locale, 'affiliates.formInvalid') },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  let code = referralCode();
  let stored = false;
  for (let attempt = 0; attempt < 3 && !stored; attempt += 1) {
    const { error } = await db.from('affiliate_partners').insert({
      name,
      email,
      website,
      audience,
      promotion_plan: promotionPlan,
      payout_email: payoutEmail,
      locale,
      referral_code: code,
    });
    if (!error) {
      stored = true;
      break;
    }
    if (error.code === '23505' && error.message.includes('email')) {
      return NextResponse.json({ ok: true });
    }
    if (error.code === '23505') {
      code = referralCode();
      continue;
    }
    console.error('[affiliates/apply] store failed', error.message);
    return NextResponse.json(
      { error: translate(locale, 'affiliates.formError') },
      { status: 500 }
    );
  }
  if (!stored) {
    return NextResponse.json(
      { error: translate(locale, 'affiliates.formError') },
      { status: 500 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const to =
      process.env.AFFILIATE_NOTIFY_EMAIL ||
      process.env.WAITLIST_NOTIFY_EMAIL ||
      'riverzoficial@gmail.com';
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:
            process.env.AFFILIATE_FROM ||
            process.env.AUTH_EMAIL_FROM ||
            'Riverz <cuentas@riverz.co>',
          to: [to],
          reply_to: email,
          subject: `Nueva solicitud de afiliado · ${email}`,
          html: `<h2>Nueva solicitud de afiliado</h2><p><strong>Nombre:</strong> ${escapeHtml(name)}</p><p><strong>Correo:</strong> ${escapeHtml(email)}</p><p><strong>Audiencia:</strong> ${escapeHtml(audience)}</p><p><strong>Plan:</strong> ${escapeHtml(promotionPlan)}</p><p><strong>Código reservado:</strong> ${escapeHtml(code)}</p>`,
        }),
      });
      if (!response.ok) {
        console.warn(
          '[affiliates/apply] notification rejected',
          response.status
        );
      }
    } catch (error) {
      console.warn('[affiliates/apply] notification failed', error);
    }
  }

  return NextResponse.json({ ok: true });
}
