import { NextResponse } from 'next/server';
import { adminGet } from '@/lib/admin/route';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { reconcileAffiliateInvoice } from '@/lib/affiliates/program';
import { stripe } from '@/lib/billing/stripe';

export const dynamic = 'force-dynamic';

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

async function sendApprovalEmail(partner: {
  name: string;
  email: string;
  referral_code: string;
  locale: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const link = `https://riverz.co/afiliados/${partner.referral_code}`;
  const locale = partner.locale === 'en' ? 'en' : 'es';
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
        to: [partner.email],
        subject: translate(locale, 'affiliates.approvalSubject'),
        html: `<h2>${translate(locale, 'affiliates.approvalSubject')}</h2><p>${escapeHtml(partner.name)},</p><p>${translate(locale, 'affiliates.approvalBody')}</p><p><a href="${link}">${link}</a></p><p>${translate(locale, 'affiliates.approvalTerms')}</p>`,
      }),
    });
    if (!response.ok) {
      console.warn(
        '[affiliates/admin] approval email rejected',
        response.status
      );
    }
  } catch (error) {
    console.warn('[affiliates/admin] approval email failed', error);
  }
}

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.affiliates' }, async () => {
    const db = supabaseAdmin();
    const [partnersResult, referralsResult, commissionsResult] =
      await Promise.all([
        db
          .from('affiliate_partners')
          .select('*')
          .order('created_at', { ascending: false }),
        db
          .from('affiliate_referrals')
          .select('id, affiliate_id, status, workspace_id, attributed_at'),
        db
          .from('affiliate_commissions')
          .select('*')
          .order('earned_at', { ascending: false }),
      ]);
    const error =
      partnersResult.error ?? referralsResult.error ?? commissionsResult.error;
    if (error) throw new Error(error.message);

    const referrals = referralsResult.data ?? [];
    const commissions = commissionsResult.data ?? [];
    const partners = (partnersResult.data ?? []).map((partner) => ({
      ...partner,
      referral_count: referrals.filter((row) => row.affiliate_id === partner.id)
        .length,
      paying_count: referrals.filter(
        (row) => row.affiliate_id === partner.id && row.status === 'paying'
      ).length,
    }));
    return { partners, referrals, commissions, now: new Date().toISOString() };
  });
}

export async function PATCH(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const awaitedLocale = await getLocale();
  const t = (key: string) => translate(awaitedLocale, key);
  const body = (await request.json().catch(() => null)) as {
    kind?: 'partner' | 'commission';
    id?: string;
    status?: 'active' | 'rejected' | 'paused';
    expectedCents?: number;
  } | null;
  if (!body?.id || !body.kind) {
    return NextResponse.json(
      { error: t('affiliates.adminSaveError') },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  if (
    body.kind === 'partner' &&
    ['active', 'rejected', 'paused'].includes(body.status ?? '')
  ) {
    const { data: partner, error: partnerError } = await db
      .from('affiliate_partners')
      .select('name, email, referral_code, status, locale')
      .eq('id', body.id)
      .maybeSingle();
    if (partnerError || !partner)
      return NextResponse.json(
        { error: t('affiliates.adminSaveError') },
        { status: 404 }
      );
    const { error } = await db
      .from('affiliate_partners')
      .update({
        status: body.status,
        approved_at: body.status === 'active' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id);
    if (error)
      return NextResponse.json(
        { error: t('affiliates.adminSaveError') },
        { status: 500 }
      );
    await recordAdminAction(gate.actor, request, {
      action: 'update.affiliate_partner',
      targetType: 'affiliate_partner',
      targetId: body.id,
      meta: { status: body.status },
    });
    if (body.status === 'active' && partner.status !== 'active') {
      await sendApprovalEmail(partner);
    }
    return NextResponse.json({ ok: true });
  }

  if (body.kind === 'commission') {
    const { data: commission } = await db
      .from('affiliate_commissions')
      .select('stripe_invoice_id')
      .eq('id', body.id)
      .maybeSingle();
    if (!commission || !Number.isSafeInteger(body.expectedCents)) {
      return NextResponse.json(
        { error: t('affiliates.adminSaveError') },
        { status: 400 }
      );
    }
    await reconcileAffiliateInvoice(db, stripe(), commission.stripe_invoice_id);
    const { data, error } = await db.rpc('mark_affiliate_commission_paid', {
      p_id: body.id,
      p_expected_cents: body.expectedCents,
    });
    if (error || !data)
      return NextResponse.json(
        { error: t('affiliates.adminSaveError') },
        { status: 400 }
      );
    await recordAdminAction(gate.actor, request, {
      action: 'update.affiliate_commission',
      targetType: 'affiliate_commission',
      targetId: body.id,
      meta: { status: 'paid', amount_cents: body.expectedCents },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: t('affiliates.adminSaveError') },
    { status: 400 }
  );
}
