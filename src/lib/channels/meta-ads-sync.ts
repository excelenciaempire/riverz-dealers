import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/channels/encryption';
import { withAppsecretProof } from '@/lib/channels/meta-graph';
import type { ChannelConnection } from '@/types';

const GRAPH = 'https://graph.facebook.com/v21.0';
const GRAPH_TIMEOUT_MS = 30_000;

export type AdDiscoveryStatus = 'ok' | 'not_configured' | 'partial' | 'failed';
export interface AdSyncResult {
  inserted: number;
  updated: number;
  discoveredPosts: number;
  scannedAccounts: number;
  status: AdDiscoveryStatus;
  /** Códigos seguros para la UI; el detalle queda en logs. */
  errors: string[];
}

interface MarketingAd {
  id?: string;
  name?: string;
  creative?: { effective_object_story_id?: string; object_story_id?: string };
  adset?: { id?: string; campaign?: { id?: string; name?: string } };
}

/** El id de historia de Meta incluye el id de página antes del guion bajo. */
export function isStoryForPage(
  postId: string | undefined,
  pageId: string
): boolean {
  return Boolean(postId && pageId && postId.startsWith(`${pageId}_`));
}

export async function syncAdPostsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
  options: { maxPages?: number } = {}
): Promise<AdSyncResult> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const pageId = String(config.page_id ?? connection.external_account_id ?? '');
  const adAccountIds = Array.from(
    new Set(
      (Array.isArray(config.ad_account_ids) ? config.ad_account_ids : [])
        .map(String)
        .filter((id) => /^act_\d+$/.test(id))
    )
  );
  const base: AdSyncResult = {
    inserted: 0,
    updated: 0,
    discoveredPosts: 0,
    scannedAccounts: 0,
    status: 'ok',
    errors: [],
  };
  if (!pageId || adAccountIds.length === 0) {
    return {
      ...base,
      status: 'not_configured',
      errors: ['ad_account_missing'],
    };
  }
  const tokenEnc = String(
    ((connection.secrets ?? {}) as Record<string, unknown>).user_access_token ??
      ''
  );
  if (!tokenEnc)
    return { ...base, status: 'failed', errors: ['ad_token_missing'] };
  let token: string;
  try {
    token = decrypt(tokenEnc);
  } catch (error) {
    console.warn(
      '[ads-sync] could not decrypt user token',
      connection.id,
      error
    );
    return { ...base, status: 'failed', errors: ['ad_token_invalid'] };
  }

  const errors: string[] = [];
  for (const adAccountId of adAccountIds) {
    let nextUrl: string | null = withAppsecretProof(
      `${GRAPH}/${adAccountId}/ads?fields=id,name,creative{id,effective_object_story_id,object_story_id},adset{id,campaign{id,name}}&limit=100&access_token=${encodeURIComponent(token)}`,
      token
    );
    let failed = false;
    for (let page = 0; nextUrl && page < (options.maxPages ?? 10); page++) {
      let response: Response;
      try {
        response = await fetch(nextUrl, {
          signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        });
      } catch (error) {
        console.warn('[ads-sync] ad request failed', {
          connectionId: connection.id,
          adAccountId,
          error,
        });
        failed = true;
        break;
      }
      if (!response.ok) {
        console.warn('[ads-sync] ad request rejected', {
          connectionId: connection.id,
          adAccountId,
          status: response.status,
          detail: (await response.text().catch(() => '')).slice(0, 500),
        });
        failed = true;
        break;
      }
      base.scannedAccounts++;
      const json = (await response.json()) as {
        data?: MarketingAd[];
        paging?: { next?: string };
      };
      for (const ad of json.data ?? []) {
        const postId =
          ad.creative?.effective_object_story_id ??
          ad.creative?.object_story_id;
        // Una cuenta publicitaria puede pautar muchas páginas: sólo acepta
        // historias de la página dueña de esta conexión.
        if (!isStoryForPage(postId, pageId)) continue;
        base.discoveredPosts++;
        const row = {
          workspace_id: connection.workspace_id,
          connection_id: connection.id,
          post_id: postId,
          ad_id: ad.id ?? null,
          adset_id: ad.adset?.id ?? null,
          campaign_id: ad.adset?.campaign?.id ?? null,
          ad_account_id: adAccountId,
          ad_name: ad.name?.slice(0, 80) ?? null,
          campaign_name: ad.adset?.campaign?.name ?? null,
          is_dark_post: true,
          last_seen_at: new Date().toISOString(),
        };
        const { data: existing } = await db
          .from('ad_posts')
          .select('id')
          .eq('workspace_id', row.workspace_id)
          .eq('post_id', postId)
          .maybeSingle();
        if (existing) {
          await db
            .from('ad_posts')
            .update(row)
            .eq('id', (existing as { id: string }).id);
          base.updated++;
        } else {
          await db.from('ad_posts').insert(row);
          base.inserted++;
        }
      }
      nextUrl = json.paging?.next
        ? withAppsecretProof(json.paging.next, token)
        : null;
    }
    if (failed) errors.push('ad_discovery_failed');
  }

  // Reflect onto already-ingested comments — flip comments_meta.is_ad
  // where the post_id is now in ad_posts. Two-step because we can't
  // JOIN-update via the JS client cleanly.
  const { data: postsForFlag } = await db
    .from('ad_posts')
    .select('post_id')
    .eq('connection_id', connection.id);
  const postIds = (postsForFlag ?? []).map(
    (p) => (p as { post_id: string }).post_id
  );
  if (postIds.length > 0) {
    await db
      .from('comments_meta')
      .update({ is_ad: true })
      .eq('connection_id', connection.id)
      .in('post_id', postIds);
  }
  base.errors = Array.from(new Set(errors));
  base.status =
    errors.length === 0
      ? 'ok'
      : base.scannedAccounts > 0
        ? 'partial'
        : 'failed';
  return base;
}
