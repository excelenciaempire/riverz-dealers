/** Pure eligibility check. Never creates a Dropi order or treats a payment screenshot as proof. */
export const DROPI_CONFIRMATION_WAIT_MS = 15 * 60_000;
export const DEUNA_DROPI_WORKSPACE = '36f81b96-41b9-4d29-b72e-11be3d3070a3';

export interface DropiReleaseEvidence {
  now: number;
  observedAt: number;
  orderRevision: string;
  confirmedRevision: string | null;
  confirmedAt: number | null;
  lastCustomerMessageAt: number | null;
  allConversationEvidenceReviewed: boolean;
  dropiStatus: string;
  classification: 'safe' | 'probable' | 'uncertain' | 'risky' | 'new' | 'unknown';
  totalMinor: number;
  currency: string;
  payment?: {
    providerVerified: boolean;
    referenceMatches: boolean;
    merchantMatches: boolean;
    liveMode: boolean;
    status: string;
    currency: string;
    amountMinor: number;
    refundedMinor: number;
    checkedAt: number;
  };
  codAmountMinor: number | null;
  codAmountVerified: boolean;
}

export function depositAmountMinor(total: number): number {
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('invalid_order_amount');
  return Math.ceil(total / 2);
}

export function evaluateDropiRelease(e: DropiReleaseEvidence): { eligible: boolean; reason: string } {
  const hold = (reason: string) => ({ eligible: false, reason });
  if (!Number.isFinite(e.now) || !Number.isFinite(e.observedAt) ||
      e.observedAt > e.now || e.now - e.observedAt > 60_000) return hold('fresh_dropi_read_required');
  if (e.dropiStatus !== 'PENDIENTE CONFIRMACION') return hold('not_awaiting_confirmation');
  if (!e.orderRevision || e.confirmedRevision !== e.orderRevision ||
      !e.allConversationEvidenceReviewed) return hold('conversation_review_required');
  if (e.confirmedAt === null || e.lastCustomerMessageAt === null ||
      !Number.isFinite(e.confirmedAt) || !Number.isFinite(e.lastCustomerMessageAt) ||
      e.confirmedAt > e.now || e.lastCustomerMessageAt > e.confirmedAt) return hold('confirmation_required');
  if (e.now - Math.max(e.confirmedAt, e.lastCustomerMessageAt) < DROPI_CONFIRMATION_WAIT_MS)
    return hold('customer_quiet_period');
  if (e.classification === 'unknown') return hold('buyer_history_required');
  if (!Number.isSafeInteger(e.totalMinor) || e.totalMinor <= 0 || e.currency !== 'COP')
    return hold('order_amount_review_required');
  if (e.classification === 'risky') {
    const p = e.payment;
    if (!p || !p.providerVerified || !p.referenceMatches || !p.merchantMatches || !p.liveMode ||
        p.status !== 'approved' || p.currency !== e.currency ||
        !Number.isSafeInteger(p.amountMinor) || p.amountMinor !== depositAmountMinor(e.totalMinor) ||
        p.refundedMinor !== 0 || !Number.isFinite(p.checkedAt) || p.checkedAt > e.now ||
        e.now - p.checkedAt > 60_000) return hold('verified_half_deposit_required');
    if (!e.codAmountVerified || e.codAmountMinor !== e.totalMinor - p.amountMinor)
      return hold('remaining_cod_amount_required');
  }
  return { eligible: true, reason: 'eligible_for_existing_order_confirmation' };
}
