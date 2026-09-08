import { describe, expect, it } from 'vitest';
import { apifyVariableCost } from './apify-billing';
import { ttsCost } from '@/lib/voice/tts-billing';
describe('variable provider cost', () => {
  it('passes an actual run cost without markup', () =>
    expect(
      apifyVariableCost({
        id: 'run',
        status: 'SUCCEEDED',
        usageTotalUsd: 0.0027,
      })
    ).toBe(0.0027));
  it('excludes monthly actor rent and only counts itemized consumption', () =>
    expect(
      apifyVariableCost({
        id: 'run',
        status: 'SUCCEEDED',
        usageTotalUsd: 49,
        pricingInfo: { pricingModel: 'FLAT_PRICE_PER_MONTH' },
        usageUsd: { ACTOR_COMPUTE_UNITS: 0.001, DATASET_READS: 0.002 },
      })
    ).toBe(0.003));
  it('does not turn a missing receipt into free usage', () =>
    expect(() => apifyVariableCost({ id: 'run', status: 'FAILED' })).toThrow(
      'wallet_apify_receipt_missing'
    ));
  it('charges Fish by UTF-8 bytes including accents and emoji', () =>
    expect(ttsCost('fish', 'ñ😊')).toBe((6 * 15) / 1e6));
});
