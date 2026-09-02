import { encrypt } from './encryption';
import { discoverMetaAccounts, subscribePageToWebhooks } from './meta-graph';
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

export async function persistMetaConnections(
  admin: ReturnType<typeof supabaseAdmin>,
  opts: {
    accessToken: string;
    channel: Channel;
    workspaceId: string;
    userId: string;
    baseSecrets?: Record<string, unknown>;
    /** When set, only persist accounts whose external_account_id (or
     *  config.page_id) is in this list — the page-picker flow. Absent =
     *  persist everything (legacy behavior). */
    pageIds?: string[];
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
  if (pageIds && pageIds.length > 0) {
    const wanted = new Set(pageIds.map(String));
    discovered = discovered.filter(
      (a) =>
        wanted.has(a.external_account_id) ||
        wanted.has(String(a.config.page_id))
    );
  }
  if (discovered.length === 0) {
    throw new MetaConnectError(
      channel === 'instagram' || channel === 'ig_comment'
        ? 'no IG Professional accounts found on your pages'
        : 'no manageable pages or accounts found'
    );
  }

  let saved = 0;
  let subscribed = 0;
  for (const account of discovered) {
    const pageId = String(
      account.config.page_id ?? account.external_account_id
    );
    const adAccountIds =
      channel === 'messenger'
        ? selectedAdAccountIds(adAccountIdsByPage, pageId)
        : [];
    const config =
      channel === 'messenger'
        ? { ...account.config, ad_account_ids: adAccountIds }
        : account.config;
    const secrets = {
      ...baseSecrets,
      access_token: encrypt(account.page_access_token),
      user_access_token: encrypt(accessToken),
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
