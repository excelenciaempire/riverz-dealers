import type { ChannelConnection } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";

interface GraphParticipant {
  id?: string;
  username?: string;
  name?: string;
}
interface GraphConversation {
  participants?: { data?: GraphParticipant[] };
}

/**
 * Build a `{ senderId → "@username" | name }` map from a Meta DM channel's
 * conversations.
 *
 * Why this exists: the per-id profile lookup (`/{IGSID}?fields=username`)
 * returns nothing for Instagram DM senders unless the app has Advanced
 * Access — so it can't be the primary name source. The conversations API
 * (`/{node}/conversations?fields=participants`) DOES carry each person's
 * username/name and works without Advanced Access, so it's the reliable
 * path. Used both by the live webhook ingest (resolve names on the first
 * message) and the meta-contact-names backfill cron.
 *
 * Paginated + capped so it never runs unbounded. Conversations come back
 * most-recent-first, so for live ingest a small `maxPages` is enough — the
 * person who just messaged is at the top.
 */
export async function buildParticipantMap(
  channel: "instagram" | "messenger",
  conn: ChannelConnection | undefined,
  token: string,
  maxPages = 12,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!token) return map;
  const cfg = (conn?.config ?? {}) as Record<string, unknown>;
  const node =
    channel === "instagram"
      ? String(cfg.ig_user_id ?? cfg.page_id ?? "me")
      : String(cfg.page_id ?? "me");
  const platform = channel === "instagram" ? "instagram" : "messenger";

  let url: string | null =
    `${GRAPH}/${node}/conversations?platform=${platform}` +
    `&fields=participants&limit=50&access_token=${encodeURIComponent(token)}`;
  let pages = 0;
  while (url && pages < maxPages) {
    pages++;
    const r = await fetch(url);
    if (!r.ok) break;
    const j = (await r.json()) as {
      data?: GraphConversation[];
      paging?: { next?: string };
    };
    for (const conv of j.data ?? []) {
      for (const p of conv.participants?.data ?? []) {
        if (!p.id) continue;
        const label =
          channel === "instagram"
            ? p.username
              ? `@${p.username.trim()}`
              : p.name?.trim() ?? null
            : p.name?.trim() ?? null;
        if (label) map.set(p.id, label);
      }
    }
    url = j.paging?.next ?? null;
  }
  return map;
}
