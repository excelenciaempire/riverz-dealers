import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/billing/stripe';
import { allocateFinancialReceipt, type FundingShare } from './financial-allocation';

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const idOf = (object: string | { id: string } | null) => typeof object === 'string' ? object : object?.id;
type Allocation = { fundingId: string; workspaceId: string; allocatedCents: number; basisCents: number };

/** Accounting convention for manual payouts: weighted current-period cash,
 * including opening/unknown funds in the denominator, never assigned to a shop.
 * This is NOT a claim that Stripe links a manual payout to particular charges. */
export function payoutFundingBasis(openingCents: number, positiveCredits: number[], payoutDebit: number): number {
  if (![openingCents, payoutDebit, ...positiveCredits].every(Number.isSafeInteger) ||
      payoutDebit <= 0 || positiveCredits.some(n => n < 0)) throw new Error('wallet_invalid_cash_basis');
  const result = Math.max(payoutDebit, Math.max(0, openingCents) + positiveCredits.reduce((a, b) => a + b, 0));
  if (!Number.isSafeInteger(result)) throw new Error('wallet_invalid_cash_basis');
  return result;
}

export async function syncFinancialCosts(db: SupabaseClient) {
  const { data: config, error } = await db.from('wallet_financial_config').select('*').eq('id', true).single();
  if (error) throw error;
  if (!config.activated_at) return { enabled: false, processing: 0, payouts: 0 };
  const client = stripe();
  const account = await client.accounts.retrieveCurrent();
  if (account.id !== config.stripe_account || account.country !== 'US' || account.default_currency !== 'usd') {
    throw new Error('wallet_financial_stripe_account_mismatch');
  }
  const activated = Date.parse(config.activated_at) / 1000;
  const known = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const page = await db.from('wallet_financial_receipts').select('id').order('id').range(offset, offset + 999);
    if (page.error) throw page.error;
    for (const row of page.data ?? []) known.add(row.id);
    if ((page.data?.length ?? 0) < 1000) break;
  }
  async function save(tx: Stripe.BalanceTransaction, kind: 'processing' | 'instant_payout', evidence: Record<string, unknown>, allocations: Allocation[]) {
    if (tx.currency !== 'usd' || !Number.isSafeInteger(tx.fee) || tx.fee < 0) throw new Error('wallet_financial_invalid_fee');
    const saved = await db.rpc('wallet_financial_import', {
      p_id: tx.id, p_kind: kind, p_fee: tx.fee, p_occurred: iso(tx.created), p_evidence: evidence, p_allocations: allocations,
    });
    if (saved.error) throw saved.error;
    known.add(tx.id);
  }
  async function funding(tx: Stripe.BalanceTransaction) {
    if (tx.type !== 'charge' || tx.currency !== 'usd' || tx.net <= 0 || tx.created < activated) return null;
    const source = idOf(tx.source);
    if (!source?.startsWith('ch_')) return null;
    const charge = await client.charges.retrieve(source);
    if (!charge.paid || charge.disputed || charge.amount_refunded > 0 || idOf(charge.balance_transaction) !== tx.id) return null;
    const paymentId = idOf(charge.payment_intent);
    if (!paymentId) return null;
    const pi = await client.paymentIntents.retrieve(paymentId);
    if (pi.created < activated || pi.status !== 'succeeded' || pi.currency !== 'usd' || pi.metadata.tipo !== 'recarga_billetera' || !pi.metadata.workspace_id) return null;
    const ws = pi.metadata.workspace_id;
    const original = await db.from('wallet_movimientos').select('id,centavos').eq('stripe_id', pi.id).eq('workspace_id', ws).eq('tipo', 'recarga').maybeSingle();
    if (original.error) throw original.error;
    // Wait for the signed payment webhook rather than importing an incomplete plan.
    if (!original.data) throw new Error('wallet_financial_waiting_for_topup');
    if (Number(original.data.centavos) !== pi.amount_received) throw new Error('wallet_financial_topup_mismatch');
    const sub = await db.from('workspace_subscriptions').select('modelo_cobro,estado').eq('workspace_id', ws).maybeSingle();
    if (sub.error) throw sub.error;
    return { id: pi.id, workspaceId: ws, basisCents: tx.net, collectedCents: 0,
      exempt: sub.data?.modelo_cobro !== 'saldo' || sub.data?.estado === 'cortesia' } satisfies FundingShare;
  }
  let processing = 0;
  // Existing top-up expense ledger remains authoritative; no charge API is called.
  for (let offset = 0; ; offset += 1000) {
    const page = await db.from('wallet_movimientos').select('detalle,centavos')
      .eq('concepto', 'comision_stripe').gte('creado_en', config.activated_at).order('id').range(offset, offset + 999);
    if (page.error) throw page.error;
    for (const row of page.data ?? []) {
      const transaction = row.detalle?.balanceTransaction;
      if (!transaction || known.has(transaction)) continue;
      const tx = await client.balanceTransactions.retrieve(transaction);
      const part = await funding(tx);
      await save(tx, 'processing', { paymentIntent: row.detalle?.paymentIntent, workspaceId: part?.workspaceId ?? null, alreadyDebited: Number(row.centavos) < 0 },
        part && !part.exempt && Number(row.centavos) >= 0 ? [{ fundingId: part.id, workspaceId: part.workspaceId, allocatedCents: tx.fee, basisCents: part.basisCents }] : []);
      processing++;
    }
    if ((page.data?.length ?? 0) < 1000) break;
  }
  let payouts = 0;
  for await (const payout of client.payouts.list({ created: { gte: Math.floor(activated) }, limit: 100 })) {
    if (payout.method !== 'instant' || payout.status !== 'paid' || payout.currency !== 'usd') continue;
    const transaction = idOf(payout.balance_transaction);
    if (!transaction || known.has(transaction)) continue;
    const tx = await client.balanceTransactions.retrieve(transaction);
    if (tx.fee === 0) { await save(tx, 'instant_payout', { payoutId: payout.id }, []); continue; }
    // Use the preceding payout boundary. Remaining old cash is always unattributed.
    const previous = await client.payouts.list({ created: { lt: payout.created }, limit: 1 });
    const boundary = previous.data[0] ? previous.data[0].created + 1 : 0;
    const balanceBefore = await client.balance.retrieve();
    const headBefore = await client.balanceTransactions.list({ limit: 1 });
    const history: Stripe.BalanceTransaction[] = [];
    for await (const item of client.balanceTransactions.list({ created: { gte: boundary }, limit: 100 })) {
      history.push(item);
      if (history.length > 10000) throw new Error('wallet_financial_history_requires_review');
    }
    const headAfter = await client.balanceTransactions.list({ limit: 1 });
    const balanceAfter = await client.balance.retrieve();
    if (headBefore.data[0]?.id !== headAfter.data[0]?.id || JSON.stringify(balanceBefore) !== JSON.stringify(balanceAfter)) {
      throw new Error('wallet_financial_cash_snapshot_changed');
    }
    const usd = history.filter(item => item.currency === 'usd');
    const totalCash = [...balanceBefore.available, ...balanceBefore.pending].filter(b => b.currency === 'usd').reduce((n, b) => n + b.amount, 0);
    const opening = totalCash - usd.reduce((n, item) => n + item.net, 0);
    // Same-second credits may already fund the payout: include them in the
    // denominator but leave their share unattributed rather than overbilling
    // an earlier merchant. Stripe timestamps do not establish ordering here.
    const periodCredits = usd.filter(item => item.created <= Math.max(payout.created, tx.created) && item.net > 0);
    // Ambiguous same-second payouts cannot be attributed safely.
    const concurrent = usd.some(item => item.type === 'payout' && item.created >= payout.created && item.created <= tx.created && item.id !== tx.id);
    const basis = payoutFundingBasis(opening, periodCredits.map(item => item.net), -tx.net);
    const shares: FundingShare[] = [];
    if (!concurrent) for (const credit of periodCredits) {
      if (credit.created >= payout.created) continue;
      const part = await funding(credit); if (part) shares.push(part);
    }
    const plan = allocateFinancialReceipt({ id: tx.id, kind: 'instant_payout', currency: 'usd', createdAt: iso(tx.created), feeCents: tx.fee, basisCents: basis }, shares, config.activated_at);
    await save(tx, 'instant_payout', { payoutId: payout.id, method: 'weighted_period_cash_v1', boundary, openingCents: opening, basisCents: basis, riverzCents: plan.riverzCents },
      plan.allocations.map(a => ({ ...a, basisCents: shares.find(s => s.id === a.fundingId)!.basisCents })));
    payouts++;
  }
  return { enabled: config.enabled, processing, payouts };
}
