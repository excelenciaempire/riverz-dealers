import { NextResponse } from 'next/server';
import { adminGet } from '@/lib/admin/route';
import { requireAdmin } from '@/lib/admin/guard';
import { csrfGuard } from '@/lib/csrf';
import { recordAdminAction } from '@/lib/admin/audit';
import { claveParaSaldo, leerSaldosParaRecarga } from '@/lib/admin/proveedores';
import { creditKeyDigest } from '@/lib/admin/provider-credit';
import {
  MANUAL_BALANCE_PROVIDERS,
  planFunding,
  type FundingSnapshot,
} from '@/lib/admin/funding';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { getT } from '@/lib/i18n/server';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.provider_balances' }, async () => {
    const db = supabaseAdmin();
    const [snapshot, providers] = await Promise.all([
      db.rpc('admin_funding_snapshot'),
      leerSaldosParaRecarga()
        .then((data) => ({ data, error: false }))
        .catch(() => ({ data: null, error: true })),
    ]);
    if (snapshot.error || !snapshot.data)
      throw new Error('Funding snapshot unavailable');
    const fundingSnapshot = snapshot.data as FundingSnapshot;
    const manual = await Promise.all(
      fundingSnapshot.manual.map(async (row) => {
        const key = await claveParaSaldo(row.provider).catch(() => null);
        return key && row.key_digest === creditKeyDigest(key) ? row : null;
      })
    );
    fundingSnapshot.manual = manual.filter(
      (row): row is NonNullable<typeof row> => row !== null
    );
    const days = Number(new URL(request.url).searchParams.get('days') ?? 7);
    return {
      ...planFunding(fundingSnapshot, providers.data?.proveedores ?? [], days),
      providersCheckedAt: providers.data?.consultadoAt ?? null,
      providersError: providers.error,
    };
  });
}

export async function PUT(request: Request) {
  const blocked = await csrfGuard(request);
  if (blocked) return blocked;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const rl = await limitByKey(`funding:${gate.actor.email}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.success) return rateLimitResponse(rl);
  const t = await getT();
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !MANUAL_BALANCE_PROVIDERS.some((id) => id === body.provider) ||
    typeof body.balanceUsd !== 'number' ||
    !Number.isFinite(body.balanceUsd) ||
    body.balanceUsd < 0 ||
    body.balanceUsd > 1_000_000
  ) {
    return NextResponse.json(
      { error: t('admin.fundingInvalidBalance') },
      { status: 400 }
    );
  }
  const key = await claveParaSaldo(body.provider).catch(() => null);
  if (!key)
    return NextResponse.json(
      { error: t('admin.fundingSaveError') },
      { status: 400 }
    );
  const { error } = await supabaseAdmin()
    .from('platform_provider_balances')
    .upsert(
      {
        provider: body.provider,
        balance_usd: body.balanceUsd,
        key_digest: creditKeyDigest(key),
        confirmed_at: new Date().toISOString(),
        updated_by: gate.actor.email,
      },
      { onConflict: 'provider' }
    );
  if (error)
    return NextResponse.json(
      { error: t('admin.fundingSaveError') },
      { status: 500 }
    );
  await recordAdminAction(gate.actor, request, {
    action: 'update.provider_balance',
    targetType: 'provider',
    targetId: body.provider,
    meta: { balanceUsd: body.balanceUsd },
  });
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
