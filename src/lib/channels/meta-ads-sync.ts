/**
 * Marketing API sync: walks each fb_comment / ig_comment connection's
 * ad accounts and refreshes `ad_posts` so the inbox can label which
 * incoming comments came from ads.
 *
 * Strategy: for each business the user can manage, list ad accounts →
 * for each ad account list ads with `creative{effective_object_story_id,
 * effective_instagram_media_id}` → upsert one ad_posts row per
 * (post_id, ad_id) tuple.
 *
 * Idempotent — calls upsert keyed on (workspace_id, post_id) so reruns
 * just bump last_seen_at and update names if they changed.
 *
 * Designed to run from a cron (Supabase Edge Function / Vercel cron /
 * GitHub Actions). Soft-fails per account so a stale token on one
 * doesn't break the rest.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/channels/encryption";
import type { ChannelConnection } from "@/types";

const GRAPH = "https://graph.facebook.com/v21.0";

interface AdRow {
  id: string;
  name: string;
  campaign_id: string;
  adset_id: string;
  effective_status: string;
  account_id: string;
  creative?: {
    effective_object_story_id?: string;
    effective_instagram_media_id?: string;
  };
}

interface CampaignRow {
  id: string;
  name: string;
}

export async function syncAdPostsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<{ inserted: number; updated: number }> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  // We persist both a page access token (for messaging APIs) and the
  // original user/system-user token (for Marketing API which needs
  // ads_read on the user). Prefer user_access_token here.
  const tokenEnc = String(secrets.user_access_token ?? secrets.access_token ?? "");
  if (!tokenEnc) {
    return { inserted: 0, updated: 0 };
  }
  const token = decrypt(tokenEnc);

  // 1. List ad accounts the user can read.
  const accountsRes = await fetch(
    `${GRAPH}/me/adaccounts?fields=id,name&access_token=${encodeURIComponent(token)}`,
  );
  if (!accountsRes.ok) {
    console.warn(`[ads-sync] /me/adaccounts failed: ${await accountsRes.text()}`);
    return { inserted: 0, updated: 0 };
  }
  const accountsJson = (await accountsRes.json()) as { data?: Array<{ id: string; name: string }> };
  const accounts = accountsJson.data ?? [];

  let inserted = 0;
  let updated = 0;

  for (const account of accounts) {
    // 2. Pull active + recently-paused ads with their creative story ids.
    //    Limit to the most recent 200 ads per account on each sync — the
    //    cron runs frequently enough that we catch new launches inside an
    //    hour. Bumping is just a config tweak.
    const adsRes = await fetch(
      `${GRAPH}/${account.id}/ads` +
        `?fields=id,name,campaign_id,adset_id,effective_status,account_id,` +
        `creative{effective_object_story_id,effective_instagram_media_id}` +
        `&limit=200&access_token=${encodeURIComponent(token)}`,
    );
    if (!adsRes.ok) {
      console.warn(`[ads-sync] ${account.id}/ads failed: ${await adsRes.text()}`);
      continue;
    }
    const adsJson = (await adsRes.json()) as { data?: AdRow[] };
    const ads = adsJson.data ?? [];

    // 3. Resolve campaign names in one batch.
    const campaignIds = Array.from(new Set(ads.map((a) => a.campaign_id).filter(Boolean)));
    const campaignNames = new Map<string, string>();
    if (campaignIds.length > 0) {
      const campRes = await fetch(
        `${GRAPH}/?ids=${campaignIds.join(",")}&fields=id,name&access_token=${encodeURIComponent(token)}`,
      );
      if (campRes.ok) {
        const campJson = (await campRes.json()) as Record<string, CampaignRow>;
        for (const [id, row] of Object.entries(campJson)) {
          campaignNames.set(id, row.name);
        }
      }
    }

    // 4. Upsert ad_posts.
    for (const ad of ads) {
      const fbPost = ad.creative?.effective_object_story_id;
      const igMedia = ad.creative?.effective_instagram_media_id;
      const postIds = [fbPost, igMedia].filter(Boolean) as string[];
      for (const postId of postIds) {
        const row = {
          workspace_id: connection.workspace_id,
          connection_id: connection.id,
          post_id: postId,
          ad_id: ad.id,
          adset_id: ad.adset_id,
          campaign_id: ad.campaign_id,
          ad_account_id: ad.account_id ?? account.id,
          ad_name: ad.name,
          campaign_name: campaignNames.get(ad.campaign_id),
          // Dark-post heuristic: if the creative effective_object_story_id
          // doesn't appear in the page's published feed, Meta treats it
          // as a dark post. We can't determine that purely from the ad
          // endpoint, so we default to false and let an optional second
          // pass refine this if needed.
          is_dark_post: false,
          last_seen_at: new Date().toISOString(),
        };
        const { data: existing } = await db
          .from("ad_posts")
          .select("id")
          .eq("workspace_id", row.workspace_id)
          .eq("post_id", postId)
          .maybeSingle();
        if (existing) {
          await db.from("ad_posts").update(row).eq("id", (existing as { id: string }).id);
          updated++;
        } else {
          await db.from("ad_posts").insert(row);
          inserted++;
        }
      }
    }
  }

  // 5. Reflect onto already-ingested comments — flip comments_meta.is_ad
  //    where the post_id is now in ad_posts. We can't run a JOIN-style
  //    UPDATE via the JS client cleanly, so use a two-step: list
  //    ad_posts.post_ids, then update comments_meta.
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
