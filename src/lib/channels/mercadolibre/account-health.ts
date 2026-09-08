import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';

export function isInactiveMLAccountError(message?: string | null): boolean {
  return ['es', 'en'].some(locale => message === translate(locale as Locale, 'errInbox.mlAccountInactive'));
}

/** A resource-level 403 does not prove the seller account is inactive. */
export async function recordInactiveMLAccount(
  db: SupabaseClient,
  connectionId: string,
  token: string,
  status: number,
  body: string,
  locale: Locale,
): Promise<string | null> {
  if (status !== 403) return null;
  let inactive = /user is not active/i.test(body);
  if (!inactive && body.includes('PA_UNAUTHORIZED_RESULT_FROM_POLICIES')) {
    try {
      const response = await fetch('https://api.mercadolibre.com/users/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      inactive = response.status === 403 && /user is not active/i.test(await response.text());
    } catch { return null; }
  }
  if (!inactive) return null;
  const message = translate(locale, 'errInbox.mlAccountInactive');
  const { error } = await db.from('channel_connections').update({
    status: 'error', last_error: message,
  }).eq('id', connectionId);
  if (error) throw new Error(`ML account health persistence: ${error.message}`);
  return message;
}
