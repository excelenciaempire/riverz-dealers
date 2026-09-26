import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/channels/encryption';
import { withAppsecretProof } from '@/lib/channels/meta-graph';
import { ESTADOS_VIVOS } from '@/lib/channels/connections';
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

/**
 * No seleccionar una cuenta publicitaria es válido: el canal sigue recibiendo
 * comentarios orgánicos. Sólo `partial`/`failed` significan que una fuente que
 * sí estaba configurada no pudo sincronizarse.
 */
export function isAdSyncFailure(
  result: { status?: AdDiscoveryStatus | string; error?: string },
): boolean {
  return Boolean(result.error) || result.status === 'partial' || result.status === 'failed';
}

export interface MarketingAd {
  id?: string;
  name?: string;
  creative?: {
    effective_object_story_id?: string;
    object_story_id?: string;
    /** El post de Instagram que muestra el anuncio (el id que traen los
     *  comentarios de Instagram en `media.id`). */
    effective_instagram_media_id?: string;
  };
  adset?: { id?: string; campaign?: { id?: string; name?: string } };
}

/** El id de historia de Meta incluye el id de página antes del guion bajo. */
export function isStoryForPage(
  postId: string | undefined,
  pageId: string
): boolean {
  return Boolean(postId && pageId && postId.startsWith(`${pageId}_`));
}

/**
 * La publicación del anuncio tal como la conoce ESTE canal, o null si el
 * anuncio no es de la página.
 *
 * Facebook comenta sobre la historia de la página (`{page}_{post}`); Instagram,
 * sobre el media de IG. Antes sólo se guardaba la historia, así que en una
 * conexión de Instagram ningún comentario de anuncio se reconocía como tal ni
 * se volvía a leer. La pertenencia se decide siempre por la historia: el media
 * de IG no dice de qué cuenta es, y leer comentarios de un media ajeno con este
 * token sólo devolvería errores.
 */
export function adPostIdForChannel(
  ad: MarketingAd,
  channel: string,
  pageId: string
): string | null {
  const storyId =
    ad.creative?.effective_object_story_id ?? ad.creative?.object_story_id;
  if (!isStoryForPage(storyId, pageId)) return null;
  if (channel === 'ig_comment') {
    return ad.creative?.effective_instagram_media_id?.trim() || null;
  }
  return storyId ?? null;
}

function normalizeAdAccountIds(value: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(String)
        .filter((id) => /^act_\d+$/.test(id))
    )
  );
}

/**
 * Cuentas publicitarias a recorrer para una conexión de comentarios.
 *
 * El comercio las elige por PÁGINA en el selector de Facebook y quedan en las
 * filas `messenger` / `fb_comment` de esa página. La conexión de Instagram de
 * la misma página no las recibe, así que sin mirar a su hermana los anuncios
 * de Instagram no se descubrían nunca. Sólo se usa lo que el comercio eligió:
 * no se listan cuentas por nuestra cuenta.
 */
export async function resolveAdAccountIds(
  db: SupabaseClient,
  connection: ChannelConnection
): Promise<string[]> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const own = normalizeAdAccountIds(config.ad_account_ids);
  if (own.length > 0) return own;
  const pageId = String(config.page_id ?? '');
  if (!pageId || !connection.workspace_id) return [];
  try {
    const { data } = await db
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', connection.workspace_id)
      .in('channel', ['messenger', 'fb_comment'])
      .in('status', [...ESTADOS_VIVOS])
      .limit(50);
    const ids = new Set<string>();
    for (const row of (data ?? []) as Array<{ config?: Record<string, unknown> | null }>) {
      if (String(row.config?.page_id ?? '') !== pageId) continue;
      for (const id of normalizeAdAccountIds(row.config?.ad_account_ids)) ids.add(id);
    }
    return [...ids];
  } catch {
    return [];
  }
}

export async function syncAdPostsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
  options: { maxPages?: number } = {}
): Promise<AdSyncResult> {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const pageId = String(config.page_id ?? connection.external_account_id ?? '');
  const adAccountIds = await resolveAdAccountIds(db, connection);
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
      `${GRAPH}/${adAccountId}/ads?fields=id,name,creative{id,effective_object_story_id,object_story_id,effective_instagram_media_id},adset{id,campaign{id,name}}&limit=100&access_token=${encodeURIComponent(token)}`,
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
        // Una cuenta publicitaria puede pautar muchas páginas: sólo acepta
        // historias de la página dueña de esta conexión.
        const postId = adPostIdForChannel(ad, connection.channel, pageId);
        if (!postId) continue;
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
