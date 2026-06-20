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

interface AdPostRow {
  id: string;
  permalink_url?: string;
  created_time?: string;
  message?: string;
}

export async function syncAdPostsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
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

  // /{page_id}/ads_posts paginates with the standard `paging.next`
  // cursor. We cap at 5 pages (≈125 posts) per run — newer ads sit
  // first so we always catch what just launched, and the cron picks
  // up the long tail incrementally.
  let nextUrl: string | null =
    `${GRAPH}/${pageId}/ads_posts?fields=id,permalink_url,created_time,message&limit=25&access_token=${encodeURIComponent(token)}`;
  let pages = 0;
  while (nextUrl && pages < 5) {
    // `paging.next` carries the access_token but not the proof — re-attach
    // on each page so "Require App Secret" doesn't 400 page 2+.
    const res = await fetch(withAppsecretProof(nextUrl, token));
    if (!res.ok) {
      console.warn(`[ads-sync] ${pageId}/ads_posts failed: ${await res.text()}`);
      break;
    }
    const json = (await res.json()) as {
      data?: AdPostRow[];
      paging?: { next?: string };
    };
    const posts = json.data ?? [];

    for (const post of posts) {
      if (!post.id) continue;
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

    nextUrl = json.paging?.next ?? null;
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
