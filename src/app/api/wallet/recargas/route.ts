import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { stripe, stripeDisponible } from '@/lib/billing/stripe';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { createClient } from '@/lib/supabase/server';
import { listTopupHistory } from '@/lib/wallet/topup-history';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId)
    return NextResponse.json({ error: 'no_workspace' }, { status: 400 });
  const page = Number(new URL(request.url).searchParams.get('pagina') ?? 0);
  try {
    const history = await listTopupHistory(
      admin,
      workspaceId,
      page,
      stripeDisponible()
        ? (id) =>
            stripe().paymentIntents.retrieve(
              id,
              {},
              { timeout: 5000, maxNetworkRetries: 0 }
            )
        : undefined
    );
    return NextResponse.json(history, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      {
        error: translate(
          await getLocale(),
          'settings.walletTopupHistoryFailed'
        ),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
