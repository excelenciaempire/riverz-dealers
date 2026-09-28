import { describe, expect, it } from 'vitest';
import { depositAmountMinor, evaluateDropiRelease, type DropiReleaseEvidence } from './dropi-release-policy';

const now = Date.parse('2026-09-28T23:00:00Z');
const base: DropiReleaseEvidence = {
  now, observedAt: now, orderRevision: 'revision-a', confirmedRevision: 'revision-a',
  confirmedAt: now - 900_000, lastCustomerMessageAt: now - 901_000,
  allConversationEvidenceReviewed: true, dropiStatus: 'PENDIENTE CONFIRMACION',
  classification: 'safe', totalMinor: 11000000, currency: 'COP',
  codAmountMinor: 11000000, codAmountVerified: true,
};
const deposit = {
  providerVerified: true, referenceMatches: true, merchantMatches: true, liveMode: true,
  status: 'approved', currency: 'COP', amountMinor: 5500000, refundedMinor: 0, checkedAt: now,
};
describe('Dropi release gates', () => {
  it('waits a full 15 minutes', () => {
    expect(evaluateDropiRelease({ ...base, confirmedAt: now - 899_999 }).reason).toBe('customer_quiet_period');
    expect(evaluateDropiRelease(base).eligible).toBe(true);
  });
  it('reopens after any new customer message or changed order', () => {
    expect(evaluateDropiRelease({ ...base, lastCustomerMessageAt: now - 1 }).eligible).toBe(false);
    expect(evaluateDropiRelease({ ...base, orderRevision: 'revision-b' }).eligible).toBe(false);
    expect(evaluateDropiRelease({ ...base, allConversationEvidenceReviewed: false }).eligible).toBe(false);
  });
  it('never creates or reconfirms supplier/transit/terminal orders', () => {
    for (const dropiStatus of ['PENDIENTE', 'NOVEDAD', 'GUIA_GENERADA', 'DESPACHADA', 'ENTREGADO', 'CANCELADO'])
      expect(evaluateDropiRelease({ ...base, dropiStatus }).eligible).toBe(false);
  });
  it('requires current buyer history', () => {
    expect(evaluateDropiRelease({ ...base, classification: 'unknown' }).eligible).toBe(false);
    expect(evaluateDropiRelease({ ...base, observedAt: now - 60_001 }).eligible).toBe(false);
  });
  it('requires approved exact half deposit and adjusted COD for risky buyers', () => {
    const risky = { ...base, classification: 'risky' as const };
    expect(evaluateDropiRelease(risky).reason).toBe('verified_half_deposit_required');
    expect(evaluateDropiRelease({ ...risky, payment: deposit }).reason).toBe('remaining_cod_amount_required');
    expect(evaluateDropiRelease({ ...risky, payment: deposit, codAmountMinor: 5500000 }).eligible).toBe(true);
  });
  it('rejects screenshots, other merchants, mismatches, refunds, test and stale payments', () => {
    for (const change of [{ providerVerified: false }, { merchantMatches: false },
      { referenceMatches: false }, { currency: 'ARS' }, { status: 'pending' },
      { refundedMinor: 1 }, { liveMode: false }, { amountMinor: 1 }, { checkedAt: now - 60_001 }]) {
      expect(evaluateDropiRelease({ ...base, classification: 'risky',
        payment: { ...deposit, ...change }, codAmountMinor: 5500000 }).eligible).toBe(false);
    }
  });
  it('rounds deposits in minor units without overstating remaining balance', () => {
    expect(depositAmountMinor(101)).toBe(51);
    for (const total of [NaN, Infinity, -1, 0, 1.1]) expect(() => depositAmountMinor(total)).toThrow();
  });
});
