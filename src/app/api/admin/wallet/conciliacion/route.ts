import { recordAdminAction } from '@/lib/admin/audit';
import { NextResponse } from 'next/server';
import { adminGet } from '@/lib/admin/route';
import { requireAdmin } from '@/lib/admin/guard';
import { csrfGuard } from '@/lib/csrf';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { summarizeWalletMargin } from '@/lib/admin/wallet-margin';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.billing' }, async () => {
    const db = supabaseAdmin();
    const [totals, pending, margin, accounts] = await Promise.all([
      db.from('wallet_conciliacion').select('*').limit(1000),
      db
        .from('wallet_operaciones')
        .select(
          'id,workspace_id,concepto,proveedor,reserva_centavos,created_at'
        )
        .eq('estado', 'reservada')
        .order('created_at')
        .limit(200),
      db.from('wallet_margen_proveedores').select('*'),
      db.from('wallet_accounts').select('resto_costo_centavos'),
    ]);
    if (totals.error || pending.error || margin.error || accounts.error)
      throw new Error('wallet_reconciliation_unavailable');
    return {
      totals: totals.data,
      pending: pending.data,
      margin: summarizeWalletMargin(
        margin.data ?? [],
        pending.data ?? [],
        accounts.data ?? []
      ),
    };
  });
}
export async function POST(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;
  const body = await request.json().catch(() => null);
  if (
    body?.tipo !== 'consumo_variable' ||
    typeof body.operacionId !== 'string' ||
    typeof body.reciboId !== 'string' ||
    !body.reciboId.trim() ||
    typeof body.costoUsd !== 'number' ||
    !Number.isFinite(body.costoUsd) ||
    body.costoUsd < 0 ||
    body.costoUsd > 5000
  )
    return NextResponse.json(
      { error: 'invalid_usage_receipt' },
      { status: 400 }
    );
  const { error } = await supabaseAdmin().rpc('wallet_conciliar_recibo', {
    p_id: body.reciboId,
    p_operacion: body.operacionId,
    p_costo_centavos: body.costoUsd * 100,
  });
  if (error)
    return NextResponse.json(
      { error: 'wallet_reconciliation_failed' },
      { status: 400 }
    );
  await recordAdminAction(auth.actor, request, {
    action: 'reconcile.wallet_usage',
    targetType: 'wallet_operation',
    targetId: body.operacionId,
    meta: { reciboId: body.reciboId, costoUsd: body.costoUsd },
  });
  return NextResponse.json({ ok: true });
}
