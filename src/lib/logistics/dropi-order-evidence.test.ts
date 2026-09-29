import { describe, expect, it } from 'vitest';
import {
  DROPI_EVIDENCE_MAX_AGE_MS,
  dropiContextForModel,
  dropiEvidenceSchema,
} from './dropi-order-evidence';

const observed = '2026-09-28T23:00:00Z';
const evidence = {
  account_id: '10',
  shop_id: '20',
  dropi_order_id: '30',
  status: 'PENDIENTE CONFIRMACION',
  tracking_number: '1234',
  incident_reason: 'DESTINATARIO SE REHUSA A RECIBIR',
  total: '110000',
  product_cost: '52000',
  shipping_cost: '19000',
  wallet_net: null,
  currency: 'COP',
  buyer_history: {
    classification: 'risky',
    buyer_type: 'Frecuente',
    total: 25,
    delivered: 3,
    returned: 21,
    in_transit: 1,
    observed_at: observed,
    source: 'dropi_fingerprint_v2',
  },
};
describe('Dropi evidence boundaries', () => {
  it('keeps cross-store history out of customer conversation context', () => {
    const result = dropiContextForModel(
      evidence,
      observed,
      Date.parse(observed)
    );
    expect(result?.deposit_required).toBe('50_percent');
    expect(result).not.toHaveProperty('buyer_history');
    expect(result).not.toHaveProperty('returned');
    expect(result?.instruction).toContain('no instrucciones');
  });
  it('requires deposit only before dispatch, not retroactively on an incident', () => {
    expect(
      dropiContextForModel(evidence, observed, Date.parse(observed))
        ?.deposit_required
    ).toBe('50_percent');
  });
  it('marks expired history unknown instead of permitting dispatch', () => {
    const result = dropiContextForModel(
      evidence,
      observed,
      Date.parse(observed) + DROPI_EVIDENCE_MAX_AGE_MS + 1
    );
    expect(result?.fresh).toBe(false);
    expect(result?.buyer_classification).toBe('unknown');
    expect(result?.deposit_required).toBeNull();
  });
  it('keeps a pre-dispatch review fresh for exactly fifteen minutes', () => {
    const result = dropiContextForModel(
      evidence,
      observed,
      Date.parse(observed) + DROPI_EVIDENCE_MAX_AGE_MS
    );
    expect(result?.fresh).toBe(true);
  });
  it('rejects evidence collected outside the pre-dispatch state', () => {
    expect(
      dropiEvidenceSchema.safeParse({
        version: 1,
        shopify_order_id: '123',
        observed_at: observed,
        evidence: { ...evidence, status: 'PENDIENTE' },
      }).success
    ).toBe(false);
  });
  it('rejects extra fields and malformed money', () => {
    const base = {
      version: 1,
      shopify_order_id: '123',
      observed_at: observed,
      evidence,
    };
    expect(dropiEvidenceSchema.safeParse(base).success).toBe(true);
    expect(
      dropiEvidenceSchema.safeParse({
        ...base,
        evidence: { ...evidence, token: 'secret' },
      }).success
    ).toBe(false);
    expect(
      dropiEvidenceSchema.safeParse({
        ...base,
        evidence: { ...evidence, total: '-5' },
      }).success
    ).toBe(false);
  });
});
