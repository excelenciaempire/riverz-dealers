import { describe, expect, it } from 'vitest';
import { anthropicFundingAlert } from './anthropic-funding-alert';
import { creditKeyDigest } from '@/lib/admin/provider-credit';
import type { FundingSnapshot } from '@/lib/admin/funding';
const key = 'synthetic-anthropic-platform-key';
const now = Date.parse('2026-10-01T04:00:00Z');
function snapshot(balance: number, spent = 0): FundingSnapshot {
  return { wallets: [{ currency: 'USD', accounts: 2, balance_cents: 4421,
    reserved_cents: 0, available_cents: 4400 }], usage: [], manual: [{ provider: 'anthropic',
    balance_usd: balance, spent_since_usd: spent, confirmed_at: new Date(now - 3600000).toISOString(),
    key_digest: creditKeyDigest(key), billing_mode: 'prepaid' }], measured_at: new Date(now).toISOString() };
}
describe('owner Anthropic credit threshold', () => {
  it.each([3, 3.01, 11.94])('does not alert at or above $3 (%s)', balance => {
    expect(anthropicFundingAlert(snapshot(balance), key, 'es', now)).toBeNull();
  });
  it('deducts recorded spend, alerts strictly below $3, and backs current merchant balances', () => {
    const alert = anthropicFundingAlert(snapshot(11.94, 9.04), key, 'es', now)!;
    expect(alert.estimatedBalanceUsd).toBeCloseTo(2.90);
    expect(alert.topUpUsd).toBe(42);
    expect(alert.line).toContain('saldo estimado');
    expect(alert.line).toContain('42,00');
    expect(alert.line).toContain('https://console.anthropic.com/settings/billing');
    expect(alert.line).toContain('https://admin.riverz.co');
  });
  it('keeps monitoring after 24h without pretending the estimate is a live API balance', () => {
    const data = snapshot(11.94, 10);
    data.manual[0].confirmed_at = new Date(now - 3 * 86400000).toISOString();
    expect(anthropicFundingAlert(data, key, 'en', now)?.line).toContain('estimated balance');
  });
  it('never alerts with missing/rotated credentials, unknown balance, postpaid mode, or invalid data', () => {
    expect(anthropicFundingAlert(snapshot(2), null, 'es', now)).toBeNull();
    expect(anthropicFundingAlert(snapshot(2), 'other-key', 'es', now)).toBeNull();
    const data = snapshot(2);
    data.manual[0].billing_mode = 'postpaid';
    expect(anthropicFundingAlert(data, key, 'es', now)).toBeNull();
    data.manual[0].billing_mode = 'prepaid';
    for (const value of [NaN, -1, Infinity]) {
      data.manual[0].balance_usd = value;
      expect(anthropicFundingAlert(data, key, 'es', now)).toBeNull();
    }
    data.manual = [];
    expect(anthropicFundingAlert(data, key, 'es', now)).toBeNull();
  });
  it('uses a stable episode key while low and rearms after a confirmed recharge', () => {
    const data = snapshot(2);
    const first = anthropicFundingAlert(data, key, 'es', now)!;
    data.manual[0].spent_since_usd = 1;
    expect(anthropicFundingAlert(data, key, 'es', now)?.key).toBe(first.key);
    data.manual[0].balance_usd = 50;
    data.manual[0].spent_since_usd = 0;
    data.manual[0].confirmed_at = new Date(now).toISOString();
    expect(anthropicFundingAlert(data, key, 'es', now)).toBeNull();
    data.manual[0].spent_since_usd = 48;
    expect(anthropicFundingAlert(data, key, 'es', now)?.key).not.toBe(first.key);
  });
  it('keeps reserved credit backed and never treats foreign wallets as USD', () => {
    const data = snapshot(2);
    data.wallets[0].reserved_cents = 4400;
    data.wallets.push({currency:'COP',accounts:1,balance_cents:999999,available_cents:999999,reserved_cents:0});
    expect(anthropicFundingAlert(data, key, 'es', now)?.topUpUsd).toBe(43);
  });
  it('does not recommend a negative amount when the estimate is exhausted', () => {
    expect(anthropicFundingAlert(snapshot(2, 30), key, 'es', now)).toMatchObject({ estimatedBalanceUsd: 0, topUpUsd: 45 });
  });
});
