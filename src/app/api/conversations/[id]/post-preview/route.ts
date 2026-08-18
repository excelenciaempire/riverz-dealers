import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { getFreshTikTokToken } from "@/lib/channels/tiktok_comment/adapter";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
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
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("*")
    .eq("id", id)
    // Treat a soft-deleted thread (migración 085) as not found — defense in
    // depth so a deep link can't pull a deleted conversation's data.
    .is("deleted_at", null)
    .maybeSingle();
  if (!conv)
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  const conversation = conv as Conversation;

  // Membership guard.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conversation.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );

  if (
    conversation.channel !== "fb_comment" &&
    conversation.channel !== "ig_comment" &&
    conversation.channel !== "tiktok_comment"
  ) {
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

  // TikTok no pasa por Graph: su hilo guarda "video:<id>|comment:<top>" y la
  // portada + el enlace al video salen del listado de videos de la cuenta.
  if (conversation.channel === "tiktok_comment") {
    return NextResponse.json(await tiktokPreview(connection, postId));
  }

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
        withAppsecretProof(
          `${GRAPH}/${postId}?fields=permalink,caption,media_url,thumbnail_url,media_type&access_token=${encodeURIComponent(token)}`,
          token,
        ),
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
      withAppsecretProof(
        `${GRAPH}/${postId}?fields=permalink_url,message,full_picture&access_token=${encodeURIComponent(token)}`,
        token,
      ),
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

/**
 * Portada, caption y enlace del video de TikTok al que pertenece el hilo.
 *
 * El listado de videos es el único endpoint que devuelve `thumbnail_url` y
 * `share_url`, así que se piden los más recientes y se busca el id — que es
 * exactamente donde vive un hilo de comentarios activo. Si el video ya no está
 * en esa ventana se devuelve vacío y el banner cae al caption que quedó
 * guardado en la conversación.
 */
async function tiktokPreview(
  connection: ChannelConnection,
  threadKey: string,
): Promise<{ permalink?: string; image?: string; caption?: string }> {
  const videoId = threadKey.startsWith("video:") ? threadKey.slice(6).split("|")[0] : "";
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? "");
  if (!videoId || !businessId) return {};
  try {
    const token = await getFreshTikTokToken(connection);
    const fields = JSON.stringify([
      "item_id",
      "caption",
      "thumbnail_url",
      "share_url",
      "embed_url",
    ]);
    const url =
      `https://business-api.tiktok.com/open_api/v1.3/business/video/list/` +
      `?business_id=${encodeURIComponent(businessId)}` +
      `&fields=${encodeURIComponent(fields)}&max_count=20`;
    const r = await fetch(url, { headers: { "Access-Token": token } });
    const j = (await r.json().catch(() => ({}))) as {
      code?: number;
      data?: { videos?: Array<Record<string, unknown>> };
    };
    if (!r.ok || (j.code ?? 0) !== 0) return {};
    const v = (j.data?.videos ?? []).find(
      (x) => String(x.item_id ?? x.video_id ?? "") === videoId,
    );
    if (!v) return {};
    return {
      permalink: String(v.share_url ?? "") || undefined,
      image: String(v.thumbnail_url ?? "") || undefined,
      caption: String(v.caption ?? "") || undefined,
    };
  } catch {
    return {};
  }
}
