/** Plan a receipt-backed allocation. This module never debits a wallet.
 * Unattributed funds stay a Riverz expense, not another merchant's bill. */
export interface FinancialReceipt {
  id: string;
  kind: 'processing' | 'instant_payout';
  currency: 'usd';
  createdAt: string;
  feeCents: number;
  basisCents: number;
}

export interface FundingShare {
  id: string;
  workspaceId: string;
  /** Verified portion of this receipt's funding, not the merchant's balance. */
  basisCents: number;
  /** Already recovered for this exact receipt and funding source. */
  collectedCents: number;
  exempt: boolean;
}

export interface FinancialAllocation {
  receiptId: string;
  fundingId: string;
  workspaceId: string;
  allocatedCents: number;
  outstandingCents: number;
}

function cents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function allocateFinancialReceipt(
  receipt: FinancialReceipt,
  shares: FundingShare[],
  activatedAt: string,
): { allocations: FinancialAllocation[]; riverzCents: number } {
  const started = Date.parse(activatedAt);
  const created = Date.parse(receipt.createdAt);
  if (!Number.isFinite(started) || !Number.isFinite(created) ||
      !receipt.id || receipt.currency !== 'usd' ||
      !['processing', 'instant_payout'].includes(receipt.kind) ||
      !cents(receipt.feeCents) || !cents(receipt.basisCents) || receipt.basisCents === 0) {
    throw new Error('wallet_invalid_financial_receipt');
  }
  const seen = new Set<string>();
  let attributed = 0n;
  for (const share of shares) {
    if (!share.id || !share.workspaceId || seen.has(share.id) ||
        !cents(share.basisCents) || !cents(share.collectedCents)) {
      throw new Error('wallet_invalid_funding_share');
    }
    seen.add(share.id);
    attributed += BigInt(share.basisCents);
  }
  if (attributed > BigInt(receipt.basisCents)) throw new Error('wallet_overallocated_receipt');
  // No retroactive recovery, including delayed imports of old receipts.
  if (created < started) return { allocations: [], riverzCents: receipt.feeCents };

  const denominator = BigInt(receipt.basisCents);
  const fee = BigInt(receipt.feeCents);
  const eligible = shares.filter(s => !s.exempt && s.basisCents > 0);
  const pool = eligible.map(share => {
    const numerator = fee * BigInt(share.basisCents);
    return { share, allocated: numerator / denominator, remainder: numerator % denominator };
  });
  // Round the merchant subtotal DOWN. The unassigned fraction belongs to
  // Riverz. Distribute remaining whole cents deterministically inside it.
  const target = fee * eligible.reduce((n, s) => n + BigInt(s.basisCents), 0n) / denominator;
  let remainder = target - pool.reduce((n, p) => n + p.allocated, 0n);
  pool.sort((a, b) => a.remainder === b.remainder
    ? (a.share.id < b.share.id ? -1 : a.share.id > b.share.id ? 1 : 0)
    : a.remainder > b.remainder ? -1 : 1);
  for (const part of pool) {
    if (remainder > 0n) { part.allocated++; remainder--; }
  }
  const allocations = pool.map(({ share, allocated }) => ({
    receiptId: receipt.id,
    fundingId: share.id,
    workspaceId: share.workspaceId,
    allocatedCents: Number(allocated),
    outstandingCents: Math.max(0, Number(allocated) - share.collectedCents),
  })).sort((a, b) => a.fundingId < b.fundingId ? -1 : a.fundingId > b.fundingId ? 1 : 0);
  return { allocations, riverzCents: receipt.feeCents - Number(target) };
}
