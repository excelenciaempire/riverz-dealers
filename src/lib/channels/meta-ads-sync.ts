/**
 * Refreshes `ad_posts` so the inbox can label which incoming comments
 * came from ads (paid posts) vs. organic posts.
 *
 * Strategy: for each connected page, hit `/{page_id}/ads_posts` with
 * the page access token. That endpoint returns every post on the page
 * that has been used as an ad creative — including dark posts (page-
 * promotable posts that don't appear in the page's normal feed).
 * Requires only `pages_read_engagement`, which the page token already
 * has from the messenger/comments use cases, so we don't need a
 * separate Marketing API token with `ads_read`.
 *
 * Idempotent — upserts keyed on (workspace_id, post_id), so reruns
 * just bump last_seen_at.
 *
 * The previous implementation used `/me/adaccounts/.../ads` which is
 * Marketing API and rejected page tokens. Kept the same DB schema so
 * existing comments_meta.is_ad backfill keeps working.
 *
 * Designed to run from a cron (GitHub Actions / Render cron). Soft-
 * fails per connection so a stale token on one doesn't break the rest.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/channels/encryption";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import type { ChannelConnection } from "@/types";

const GRAPH = "https://graph.facebook.com/v21.0";
const GRAPH_TIMEOUT_MS = 30_000;

interface AdPostRow {
  id: string;
  permalink_url?: string;
  created_time?: string;
  message?: string;
}

export async function syncAdPostsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
  options: { maxPages?: number; sinceMs?: number } = {},
): Promise<{ inserted: number; updated: number }> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const tokenEnc = String(secrets.access_token ?? "");
  if (!tokenEnc) {
    return { inserted: 0, updated: 0 };
  }
  const token = decrypt(tokenEnc);

  // The page id is required to call /{page_id}/ads_posts. For
  // ig_comment connections the connection's external_account_id is the
  // IG user id, so we read page_id from config (filled in by the
  // OAuth callback discovery step).
  const pageId = String(config.page_id ?? connection.external_account_id ?? "");
  if (!pageId) {
    return { inserted: 0, updated: 0 };
  }

  let inserted = 0;
  let updated = 0;

  // El cron normal recorre sólo lo reciente. El backfill manual puede pedir
  // todo el historial y reemplaza este tope para no dejar anuncios viejos
  // afuera.
  const maxPages = options.maxPages ?? 5;
  const sinceMs = options.sinceMs;
  let nextUrl: string | null =
    `${GRAPH}/${pageId}/ads_posts?fields=id,permalink_url,created_time,message&limit=25` +
    `${sinceMs !== undefined ? `&since=${Math.floor(sinceMs / 1000)}` : ""}` +
    `&access_token=${encodeURIComponent(token)}`;
  let pages = 0;
  while (nextUrl && pages < maxPages) {
    // `paging.next` carries the access_token but not the proof — re-attach
    // on each page so "Require App Secret" doesn't 400 page 2+.
    let res: Response;
    try {
      res = await fetch(withAppsecretProof(nextUrl, token), {
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn(`[ads-sync] ${pageId}/ads_posts request failed:`, error);
      break;
    }
    if (!res.ok) {
      console.warn(`[ads-sync] ${pageId}/ads_posts failed: ${await res.text()}`);
      break;
    }
    const json = (await res.json()) as {
      data?: AdPostRow[];
      paging?: { next?: string };
    };
    const posts = json.data ?? [];
    // Algunos cursores de Meta conservan `next` aun después de que un filtro
    // de fecha vacía la página. Sin este corte, un backfill puede recorrer un
    // cursor vacío indefinidamente.
    if (posts.length === 0) break;

    for (const post of posts) {
      if (!post.id) continue;
      const createdAt = post.created_time ? Date.parse(post.created_time) : NaN;
      // `ads_posts` llega de más nuevo a más viejo. Un backfill con rango no
      // necesita recorrer años de creatividades para terminar encontrando las
      // del período pedido. Si Meta omite la fecha, la conservamos: saltarla
      // podría esconder una creatividad válida.
      if (sinceMs !== undefined && Number.isFinite(createdAt) && createdAt < sinceMs) {
        continue;
      }
      const row = {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        post_id: post.id,
        // /ads_posts doesn't carry ad_id directly — that requires
        // Marketing API. We leave it null; the post-level `is_ad`
        // flag is still set on comments_meta below, which is what the
        // inbox UI reads.
        ad_id: null,
        adset_id: null,
        campaign_id: null,
        ad_account_id: null,
        ad_name: post.message?.slice(0, 80),
        campaign_name: null,
        is_dark_post: false,
        last_seen_at: new Date().toISOString(),
      };
      const { data: existing } = await db
        .from("ad_posts")
        .select("id")
        .eq("workspace_id", row.workspace_id)
        .eq("post_id", post.id)
        .maybeSingle();
      if (existing) {
        await db.from("ad_posts").update(row).eq("id", (existing as { id: string }).id);
        updated++;
      } else {
        await db.from("ad_posts").insert(row);
        inserted++;
      }
    }

    const oldest = posts
      .map((post) => (post.created_time ? Date.parse(post.created_time) : NaN))
      .filter(Number.isFinite)
      .reduce<number | null>((min, time) => (min === null || time < min ? time : min), null);
    // El listado está ordenado de reciente a antiguo; cuando esta página ya
    // pasó el inicio solicitado, las siguientes no pueden aportar anuncios al
    // backfill. En un recorrido completo (`sinceMs` ausente) se mantiene la
    // paginación histórica original.
    nextUrl = sinceMs !== undefined && oldest !== null && oldest < sinceMs
      ? null
      : (json.paging?.next ?? null);
    pages++;
  }

  // Reflect onto already-ingested comments — flip comments_meta.is_ad
  // where the post_id is now in ad_posts. Two-step because we can't
  // JOIN-update via the JS client cleanly.
  const { data: postsForFlag } = await db
    .from("ad_posts")
    .select("post_id")
    .eq("workspace_id", connection.workspace_id);
  const postIds = (postsForFlag ?? []).map((p) => (p as { post_id: string }).post_id);
  if (postIds.length > 0) {
    await db.from("comments_meta").update({ is_ad: true }).in("post_id", postIds);
  }

  return { inserted, updated };
}
