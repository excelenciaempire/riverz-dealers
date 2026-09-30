import type { Proveedor } from './proveedores';

export const MANUAL_BALANCE_PROVIDERS = [
  'anthropic',
  'groq',
  'openai',
  'cerebras',
  'gemini',
  'typesafe',
] as const;
export const FUNDING_DAYS = [7, 14, 30] as const;
const MINIMUM: Record<string, number> = {
  anthropic: 10,
  groq: 5,
  openai: 5,
  cerebras: 5,
  gemini: 5,
  typesafe: 5,
  telnyx: 10,
  deepgram: 15,
  fish: 5,
};

export interface FundingSnapshot {
  wallets: Array<{
    currency: string;
    accounts: number;
    balance_cents: number | string;
    reserved_cents: number | string;
    available_cents: number | string;
  }>;
  usage: Array<{ provider: string; usd_week: number | string }>;
  manual: Array<{
    provider: string;
    balance_usd: number | string;
    confirmed_at: string;
    spent_since_usd: number | string;
    key_digest?: string;
  }>;
  measured_at: string;
}
export interface FundingProvider extends Proveedor {
  dailyUsd: number;
  targetUsd: number;
  topUpUsd: number | null;
  daysLeft: number | null;
  source: 'api' | 'estimate' | 'unknown';
  confirmedAt: string | null;
  needsConfirmation: boolean;
}
export interface Funding {
  wallets: Array<{
    currency: string;
    accounts: number;
    balance: number;
    reserved: number;
    available: number;
  }>;
  providers: FundingProvider[];
  topUpUsd: number;
  unknown: number;
  days: number;
  dailyUsd: number;
  unallocatedUsd: number;
  measuredAt: string;
  providersCheckedAt: string | null;
  providersError: boolean;
}

export function planFunding(
  snapshot: FundingSnapshot,
  providers: Proveedor[],
  days = 7,
  now = Date.now()
): Funding {
  const horizon = FUNDING_DAYS.includes(days as 7 | 14 | 30) ? days : 7;
  const usage = new Map(
    snapshot.usage.map((u) => [u.provider, Number(u.usd_week)])
  );
  const rows = providers
    .filter((p) => p.recargable)
    .map((p): FundingProvider => {
      const manual = snapshot.manual.find((m) => m.provider === p.id);
      const age = manual
        ? now - new Date(manual.confirmed_at).getTime()
        : Infinity;
      const currentManual =
        MANUAL_BALANCE_PROVIDERS.some((id) => id === p.id) &&
        manual &&
        age >= 0 &&
        age < 24 * 60 * 60 * 1000;
      const apiBalance = p.saldo !== null && Number.isFinite(p.saldo);
      const manualBalance = currentManual
        ? Math.max(
            0,
            Number(manual.balance_usd) - Number(manual.spent_since_usd)
          )
        : null;
      const source = apiBalance
        ? 'api'
        : manualBalance !== null && Number.isFinite(manualBalance)
          ? 'estimate'
          : 'unknown';
      const saldo =
        p.estado === 'sin_saldo' && source === 'estimate'
          ? 0
          : source === 'estimate'
            ? manualBalance
            : apiBalance
              ? p.saldo
              : null;
      const unidad = source === 'estimate' ? 'USD' : p.unidad;
      const dailyUsd = Math.max(0, usage.get(p.id) ?? 0) / 7;
      const targetUsd = Math.max(MINIMUM[p.id] ?? 0, dailyUsd * horizon);
      const healthy = !['error', 'sin_llave'].includes(p.estado);
      const monetary = unidad?.toUpperCase() === 'USD';
      // A quota or an expired manual observation cannot be used as spendable cash.
      const topUpUsd =
        saldo !== null && monetary && healthy && targetUsd > 0
          ? Math.ceil(Math.max(0, targetUsd - saldo))
          : null;
      const low =
        saldo !== null &&
        monetary &&
        healthy &&
        targetUsd > 0 &&
        saldo < targetUsd;
      const state =
        p.estado === 'sin_saldo' || !healthy
          ? p.estado
          : source === 'estimate'
            ? saldo! <= 0
              ? 'sin_saldo'
              : low
                ? 'bajo'
                : 'ok'
            : p.estado;
      return {
        ...p,
        saldo,
        unidad,
        estado: state,
        dailyUsd,
        targetUsd,
        topUpUsd,
        daysLeft:
          saldo !== null && monetary && dailyUsd > 0
            ? Math.max(0, saldo) / dailyUsd
            : null,
        source,
        confirmedAt: manual?.confirmed_at ?? null,
        needsConfirmation:
          !apiBalance && MANUAL_BALANCE_PROVIDERS.some((id) => id === p.id),
      };
    })
    .sort((a, b) => {
      const rank = (p: FundingProvider) =>
        p.estado === 'sin_saldo'
          ? 0
          : (p.topUpUsd ?? 0) > 0
            ? 1
            : p.source === 'unknown'
              ? 2
              : 3;
      return rank(a) - rank(b) || (b.topUpUsd ?? 0) - (a.topUpUsd ?? 0);
    });
  const known = new Set(rows.map((p) => p.id));
  return {
    wallets: snapshot.wallets.map((w) => ({
      currency: w.currency,
      accounts: Number(w.accounts),
      balance: Number(w.balance_cents) / 100,
      reserved: Number(w.reserved_cents) / 100,
      available: Number(w.available_cents) / 100,
    })),
    providers: rows,
    topUpUsd: rows.reduce((sum, p) => sum + (p.topUpUsd ?? 0), 0),
    unknown: rows.filter((p) => p.topUpUsd === null && p.estado !== 'sin_llave')
      .length,
    days: horizon,
    dailyUsd:
      snapshot.usage.reduce((sum, u) => sum + Number(u.usd_week), 0) / 7,
    unallocatedUsd: snapshot.usage
      .filter((u) => !known.has(u.provider))
      .reduce((sum, u) => sum + Number(u.usd_week), 0),
    measuredAt: snapshot.measured_at,
    providersCheckedAt: null,
    providersError: false,
  };
}
