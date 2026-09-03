import { encrypt } from './encryption';
import {
  discoverMetaAccounts,
  subscribePageToWebhooks,
  type DiscoveredAccount,
} from './meta-graph';
import { upsertConnectionRow } from './upsert-connection';
import type { supabaseAdmin } from './admin-client';
import type { Channel } from '@/types';

/**
 * Shared Meta connection persistence — discover the pages / IG accounts a
 * user token can manage, write one channel_connections row per account, and
 * subscribe each to the right webhook fields. Used by both the OAuth
 * redirect callback and the Facebook-Login-for-Business JS SDK flow
 * (/api/connections/meta/sdk-connect), so the two paths stay identical.
 */

export class MetaConnectError extends Error {}

/** Facebook Login user tokens exchanged by the SDK live for roughly 60 days.
 * Persist the deadline explicitly: `updated_at` also changes when messages
 * arrive, so it is not a safe proxy for token age. */
const META_TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

export interface PersistMetaResult {
  saved: number;
  subscribed: number;
}

/** Normaliza el valor que se guarda en UNA conexión de página, sin mezclar
 * las elecciones de otras páginas del mismo comercio. */
export function selectedAdAccountIds(
  adAccountIdsByPage: Record<string, string[]>,
  pageId: string
): string[] {
  return Array.from(
    new Set(
      (adAccountIdsByPage[pageId] ?? [])
        .map(String)
        .filter((id) => /^act_\d+$/.test(id))
    )
  );
}

/**
 * Reconnecting a Facebook page must not silently erase its ad-comment
 * account choices. We only write `ad_account_ids` when the picker explicitly
 * supplied a choice for that page; otherwise upsertConnectionRow keeps the
 * prior config while it refreshes the token.
 */
export function metaConnectionConfig(
  channel: Channel,
  accountConfig: Record<string, unknown>,
  pageId: string,
  adAccountIdsByPage: Record<string, string[]>
): Record<string, unknown> {
  if (
    channel !== 'messenger' ||
    !Object.prototype.hasOwnProperty.call(adAccountIdsByPage, pageId)
  ) {
    return accountConfig;
  }
  return {
    ...accountConfig,
    ad_account_ids: selectedAdAccountIds(adAccountIdsByPage, pageId),
  };
}

/**
 * Meta may return every Page managed by the Facebook profile. A Riverz
 * workspace, however, must only receive the accounts explicitly selected for
 * that workspace. Do not accept a partial match: saving the accounts Meta did
 * return would silently replace a missing brand with another one.
 */
export function selectMetaAccounts(
  discovered: DiscoveredAccount[],
  pageIds: string[]
): DiscoveredAccount[] {
  const wanted = new Set(pageIds.map((id) => id.trim()).filter(Boolean));
  if (wanted.size === 0) {
    throw new MetaConnectError('meta_asset_selection_required');
  }

  const matches = (account: DiscoveredAccount, id: string) =>
    id === account.external_account_id || id === String(account.config.page_id);
  const unavailable = [...wanted].filter(
    (id) => !discovered.some((account) => matches(account, id))
  );
  if (unavailable.length > 0) {
    throw new MetaConnectError('meta_selected_asset_unavailable');
  }

  return discovered.filter((account) =>
    [...wanted].some((id) => matches(account, id))
  );
}

type ExistingMetaConnection = {
  id: string;
  channel: Channel;
  external_account_id: string | null;
  config: Record<string, unknown> | null;
  secrets: Record<string, unknown> | null;
};

/**
 * A Meta consent can cover several brands, while Riverz keeps each brand in
 * its own workspace. A token may be refreshed across workspaces only when it
 * belongs to the exact same Page and (for Instagram) the exact same IG user.
 * This is a credential refresh, never an asset import or reassignment.
 */
export function isExactMetaAssetMatch(
  connection: ExistingMetaConnection,
  account: DiscoveredAccount
): boolean {
  const config = connection.config ?? {};
  const pageId = String(config.page_id ?? '');
  if (!pageId || pageId !== String(account.config.page_id ?? '')) return false;

  const isInstagram =
    connection.channel === 'instagram' || connection.channel === 'ig_comment';
  if (isInstagram) {
    const igUserId = String(
      config.ig_user_id ?? connection.external_account_id ?? ''
    );
    return (
      igUserId === String(account.config.ig_user_id ?? '') &&
      connection.external_account_id === account.external_account_id
    );
  }
  return (
    (connection.channel === 'messenger' ||
      connection.channel === 'fb_comment') &&
    connection.external_account_id === account.external_account_id
  );
}

async function refreshExactExistingMetaConnections(
  admin: ReturnType<typeof supabaseAdmin>,
  accounts: DiscoveredAccount[],
  accessToken: string,
  tokenExpiresAt: string
): Promise<void> {
  const family = accounts[0]?.channel;
  const channels =
    family === 'messenger'
      ? ['messenger', 'fb_comment']
      : family === 'instagram'
        ? ['instagram', 'ig_comment']
        : [];
  if (channels.length === 0) return;

  const { data, error } = await admin
    .from('channel_connections')
    .select('id, channel, external_account_id, config, secrets')
    .in('channel', channels)
    .neq('status', 'disconnected');
  if (error) {
    console.warn('[meta-connect] could not load exact existing assets:', error);
    return;
  }

  const rows = (data ?? []) as ExistingMetaConnection[];
  for (const account of accounts) {
    const secrets = {
      access_token: encrypt(account.page_access_token),
      user_access_token: encrypt(accessToken),
      access_token_expires_at: tokenExpiresAt,
    };
    for (const connection of rows.filter((row) =>
      isExactMetaAssetMatch(row, account)
    )) {
      const { error: updateError } = await admin
        .from('channel_connections')
        .update({
          status: 'connected',
          last_error: null,
          secrets: { ...(connection.secrets ?? {}), ...secrets },
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);
      if (updateError) {
        console.warn(
          `[meta-connect] could not refresh exact asset ${connection.id}:`,
          updateError
        );
      }
    }
  }
}

export async function persistMetaConnections(
  admin: ReturnType<typeof supabaseAdmin>,
  opts: {
    accessToken: string;
    channel: Channel;
    workspaceId: string;
    userId: string;
    baseSecrets?: Record<string, unknown>;
    /** Explicit account ids from the picker. A Meta login never implicitly
     * imports every Page visible to the Facebook profile. */
    pageIds: string[];
    /** Cuentas de anuncios elegidas por página. Sólo aplica a Facebook. */
    adAccountIdsByPage?: Record<string, string[]>;
  }
): Promise<PersistMetaResult> {
  const {
    accessToken,
    channel,
    workspaceId,
    userId,
    baseSecrets = {},
    pageIds,
    adAccountIdsByPage = {},
  } = opts;

  let discovered;
  try {
    discovered = await discoverMetaAccounts(accessToken, channel);
  } catch (err) {
    console.error(`[meta-connect] discovery failed:`, err);
    throw new MetaConnectError('could not list pages/accounts');
  }
  const allDiscovered = discovered;
  discovered = selectMetaAccounts(allDiscovered, pageIds);
  if (discovered.length === 0) {
    throw new MetaConnectError(
      channel === 'instagram' || channel === 'ig_comment'
        ? 'no IG Professional accounts found on your pages'
        : 'no manageable pages or accounts found'
    );
  }

  let saved = 0;
  let subscribed = 0;
  const tokenExpiresAt = new Date(
    Date.now() + META_TOKEN_LIFETIME_MS
  ).toISOString();
  // Meta can revoke a prior page token when the same Facebook profile renews
  // its consent. If that consent includes several already-linked brands,
  // refresh only rows that already map to those exact assets — no account is
  // added, moved, or relabeled across Riverz workspaces.
  await refreshExactExistingMetaConnections(
    admin,
    allDiscovered,
    accessToken,
    tokenExpiresAt
  );
  for (const account of discovered) {
    const pageId = String(
      account.config.page_id ?? account.external_account_id
    );
    const config = metaConnectionConfig(
      channel,
      account.config,
      pageId,
      adAccountIdsByPage
    );
    const secrets = {
      ...baseSecrets,
      access_token: encrypt(account.page_access_token),
      user_access_token: encrypt(accessToken),
      access_token_expires_at: tokenExpiresAt,
    };
    const up = await upsertConnectionRow(admin, {
      workspace_id: workspaceId,
      channel,
      label: account.label,
      external_account_id: account.external_account_id,
      config,
      secrets,
      created_by: userId,
    });
    if (up.error) {
      console.error(
        `[meta-connect] upsert failed for ${account.label}:`,
        up.error
      );
      continue;
    }
    saved++;

    // Crear también la conexión hermana de COMENTARIOS de esta cuenta
    // (messenger→fb_comment, instagram→ig_comment). Sin esta fila, el webhook
    // de comentarios (page feed / instagram comments) no se puede atribuir a
    // ninguna conexión y se descarta. Misma cuenta, mismo token (la respuesta
    // al comentario usa el page token).
    const commentSibling =
      channel === 'messenger'
        ? 'fb_comment'
        : channel === 'instagram'
          ? 'ig_comment'
          : null;
    if (commentSibling) {
      const cUp = await upsertConnectionRow(admin, {
        workspace_id: workspaceId,
        channel: commentSibling,
        label: account.label,
        external_account_id: account.external_account_id,
        config,
        secrets,
        created_by: userId,
      });
      if (cUp.error) {
        console.error(
          `[meta-connect] comment-sibling upsert failed for ${account.label}:`,
          cUp.error
        );
      }
    }

    if (channel !== 'whatsapp') {
      const igUserId = account.config.ig_user_id as string | undefined;
      // Retry on a transient failure — a dropped subscribe leaves a page that
      // shows "connected" but receives NOTHING (and, until the verify cron
      // runs, silently). subscribePageToWebhooks is idempotent (read-union-post),
      // so retrying is safe. The cron is the eventual backstop; this closes the
      // common transient-5xx/rate-limit case at connect time.
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          await subscribePageToWebhooks({
            channel,
            pageId,
            pageAccessToken: account.page_access_token,
            igUserId,
          });
          ok = true;
          subscribed++;
        } catch (err) {
          console.warn(
            `[meta-connect] subscribe failed (attempt ${attempt + 1}) for ${account.label}:`,
            err
          );
        }
      }
    }
  }

  return { saved, subscribed };
}
