import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { decrypt, encrypt } from '../encryption';

/** Return the Zoho Accounts host saved at connection time, never a value sent
 * by the browser. This keeps refreshes in the customer's own data centre. */
export function accountsUrl(connection: ChannelConnection): string {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const value = String(
    config.zoho_accounts_url ??
      process.env.ZOHO_ACCOUNTS_URL ??
      'https://accounts.zoho.com'
  );
  return value.replace(/\/$/, '');
}

/** The Mail API follows the same regional suffix as the Accounts server. */
export function mailApiUrl(connection: ChannelConnection): string {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const saved = String(config.zoho_mail_url ?? '').trim();
  if (saved) return saved.replace(/\/$/, '');
  const explicit = String(process.env.ZOHO_MAIL_API_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return accountsUrl(connection).replace('//accounts.', '//mail.');
}

/** Refresh and persist the short-lived Zoho token before a mail API call. */
export async function getFreshZohoAccessToken(
  admin: SupabaseClient,
  connection: ChannelConnection
): Promise<string> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encryptedAccess = String(secrets.access_token ?? '');
  const encryptedRefresh = String(secrets.refresh_token ?? '');
  if (!encryptedAccess)
    throw new Error('[zoho] connection missing access_token');

  const expiresAt = secrets.access_token_expires_at
    ? new Date(String(secrets.access_token_expires_at)).getTime()
    : 0;
  if (expiresAt && expiresAt - 60_000 > Date.now())
    return decrypt(encryptedAccess);
  if (!encryptedRefresh) return decrypt(encryptedAccess);

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[zoho] ZOHO_CLIENT_ID/SECRET missing — cannot refresh');
  }

  const response = await fetch(`${accountsUrl(connection)}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: decrypt(encryptedRefresh),
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `[zoho] token refresh failed (${response.status}): ${await response.text()}`
    );
  }
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token)
    throw new Error('[zoho] token refresh returned no access_token');

  await admin
    .from('channel_connections')
    .update({
      secrets: {
        ...secrets,
        access_token: encrypt(json.access_token),
        access_token_expires_at: new Date(
          Date.now() + Number(json.expires_in ?? 3600) * 1000
        ).toISOString(),
      },
    })
    .eq('id', connection.id);
  return json.access_token;
}
