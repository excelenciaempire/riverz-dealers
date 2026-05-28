import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import type { ChannelConnection, Conversation } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * GET /api/conversations/:id/post-preview
 *
 * For a FB/IG comment thread, resolves the publication the comment was
 * left on — permalink, thumbnail and caption — so the inbox can show
 * "which ad/post is this about" instead of a bare id. Uses the page
 * token stored on the comment connection.
 *
 * Returns { permalink?, image?, caption?, isAd?, adId? } or 204-ish
 * empty payload when nothing can be resolved (best-effort, never 500s
 * the thread view).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const conversation = conv as Conversation;

  // Membership guard.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conversation.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (conversation.channel !== "fb_comment" && conversation.channel !== "ig_comment") {
    return NextResponse.json({});
  }
  const postId = conversation.thread_external_id;
  if (!postId || !conversation.connection_id) return NextResponse.json({});

  const { data: connRow } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", conversation.connection_id)
    .maybeSingle();
  if (!connRow) return NextResponse.json({});
  const connection = connRow as ChannelConnection;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!enc) return NextResponse.json({});
  const token = decrypt(enc);

  // Ad id from the comment sidecar (if this comment was on an ad).
  const { data: meta } = await admin
    .from("comments_meta")
    .select("ad_id, is_ad, permalink")
    .eq("post_id", postId)
    .limit(1)
    .maybeSingle();

  try {
    if (conversation.channel === "ig_comment") {
      const r = await fetch(
        `${GRAPH}/${postId}?fields=permalink,caption,media_url,thumbnail_url,media_type&access_token=${encodeURIComponent(token)}`,
      );
      if (!r.ok) return NextResponse.json({ adId: meta?.ad_id, isAd: meta?.is_ad });
      const m = (await r.json()) as {
        permalink?: string;
        caption?: string;
        media_url?: string;
        thumbnail_url?: string;
        media_type?: string;
      };
      return NextResponse.json({
        permalink: m.permalink,
        image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
        caption: m.caption,
        isAd: meta?.is_ad ?? false,
        adId: meta?.ad_id,
      });
    }
    // fb_comment
    const r = await fetch(
      `${GRAPH}/${postId}?fields=permalink_url,message,full_picture&access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) {
      return NextResponse.json({
        permalink: meta?.permalink ?? `https://facebook.com/${postId}`,
        adId: meta?.ad_id,
        isAd: meta?.is_ad,
      });
    }
    const p = (await r.json()) as {
      permalink_url?: string;
      message?: string;
      full_picture?: string;
    };
    return NextResponse.json({
      permalink: p.permalink_url ?? meta?.permalink ?? `https://facebook.com/${postId}`,
      image: p.full_picture,
      caption: p.message,
      isAd: meta?.is_ad ?? false,
      adId: meta?.ad_id,
    });
  } catch {
    return NextResponse.json({ adId: meta?.ad_id, isAd: meta?.is_ad });
  }
}
