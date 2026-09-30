import type { FundingSnapshot } from '@/lib/admin/funding';
import { creditKeyDigest } from '@/lib/admin/provider-credit';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';

export const ANTHROPIC_ALERT_THRESHOLD_USD = 3;
export const ANTHROPIC_FUNDING_ALERT_PREFIX = 'saldo:anthropic:menos_3:';
const BILLING_URL = 'https://console.anthropic.com/settings/billing';

/** An estimate, never a claim to have read Anthropic's unavailable credit API.
 * Unlike the dashboard's fresh-balance card, monitoring must keep deducting
 * known usage after 24h; otherwise the warning stops just before funds run out.
 * A new confirmed balance/key starts a new funding episode, independently of
 * the other platform incidents' 24h anti-flapping guard.
 */
export function anthropicFundingAlert(
  snapshot: FundingSnapshot, activeKey: string | null, locale: Locale = 'es', now = Date.now(),
): { key: string; line: string; estimatedBalanceUsd: number; topUpUsd: number } | null {
  const observation = snapshot.manual.find(row => row.provider === 'anthropic');
  if (!activeKey || !observation || observation.billing_mode === 'postpaid' ||
    observation.key_digest !== creditKeyDigest(activeKey)) return null;
  const confirmed = Date.parse(observation.confirmed_at);
  const balance = Number(observation.balance_usd);
  const spent = Number(observation.spent_since_usd);
  if (!Number.isFinite(confirmed) || confirmed > now ||
    !Number.isFinite(balance) || balance < 0 || !Number.isFinite(spent) || spent < 0) return null;
  const estimatedBalanceUsd = Math.max(0, balance - spent);
  if (estimatedBalanceUsd >= ANTHROPIC_ALERT_THRESHOLD_USD) return null;
  const usdWallets = snapshot.wallets.filter(row => row.currency.toUpperCase() === 'USD');
  if (usdWallets.some(row => !Number.isFinite(Number(row.balance_cents)))) return null;
  const merchantUsd = Math.max(0, usdWallets.reduce((sum, row) => sum + Number(row.balance_cents) / 100, 0));
  // Back merchant credit; when it is lower than $3, restore at least the alert floor.
  const topUpUsd = Math.ceil(Math.max(ANTHROPIC_ALERT_THRESHOLD_USD, merchantUsd) - estimatedBalanceUsd);
  const format = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const line = translate(locale, 'admin.anthropicLowBalanceAlert', {
    balance: format(estimatedBalanceUsd), amount: format(topUpUsd), url: BILLING_URL,
    adminUrl: 'https://admin.riverz.co',
  });
  return { key: ANTHROPIC_FUNDING_ALERT_PREFIX + observation.key_digest + ':' + confirmed,
    line, estimatedBalanceUsd, topUpUsd };
}
