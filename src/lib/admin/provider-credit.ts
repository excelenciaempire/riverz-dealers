import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export function creditFailure(status: number, body: unknown): boolean {
  if (status === 402) return true;
  if (status !== 400 && status !== 429 && status !== 403) return false;
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return ['blocked_api_access', 'insufficient_quota', 'insufficient_credits', 'insufficient_balance'].includes(error?.code ?? '') ||
    /credit balance is too low|insufficient (?:credits|credit balance)|billing hard limit/i.test(error?.message ?? '');
}
export const creditKeyDigest = (key: string) => createHash('sha256').update(key).digest('hex');
const recent = new Map<string, { state: string; at: number }>();

export function activeCreditState(provider: string, key: string, signals: Array<{ provider: string; key_digest: string; state: string }>): string | null {
  return signals.find((signal) => signal.provider === provider && signal.key_digest === creditKeyDigest(key))?.state ?? null;
}

/** Observe existing paid calls, never make extra paid calls or charge a merchant.
 * Digest matching prevents a BYOK or an obsolete key from alarming the platform. */
export async function observePlatformCredit(db: SupabaseClient, provider: string, key: string, response: Response) {
  if (!key) return;
  let state: 'ok' | 'sin_saldo';
  if (response.ok) state = 'ok';
  else {
    if (![400, 402, 403, 429].includes(response.status)) return;
    const body = await response.clone().json().catch(() => null);
    if (!creditFailure(response.status, body)) return;
    state = 'sin_saldo';
  }
  const digest = creditKeyDigest(key);
  const cacheKey = `${provider}:${digest}`;
  const previous = recent.get(cacheKey);
  if (previous?.state === state && Date.now() - previous.at < 60_000) return;
  try {
    const query = db.from('platform_provider_credit_signals').upsert({
      provider, key_digest: digest, state, recorded_at: new Date().toISOString(),
    }, { onConflict: 'provider' });
    query.abortSignal(AbortSignal.timeout(2_500));
    const { error } = await query;
    if (error) console.warn('[provider-credit] signal write failed', { provider });
    else {
      if (recent.size > 256) recent.clear();
      recent.set(cacheKey, { state, at: Date.now() });
    }
  } catch { console.warn('[provider-credit] signal write failed', { provider }); }
}
