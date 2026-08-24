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

  // TikTok no pasa por Graph: su hilo guarda "video:<id>|comment:<top>".
  if (conversation.channel === "tiktok_comment") {
    return NextResponse.json(
      await tiktokPreview(admin, conversation.workspace_id, connection, postId),
    );
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
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  connection: ChannelConnection,
  threadKey: string,
): Promise<{ permalink?: string; image?: string; caption?: string }> {
  const videoId = threadKey.startsWith("video:") ? threadKey.slice(6).split("|")[0] : "";
  if (!videoId) return {};

  // El texto y el enlace salen de `tiktok_videos`, donde está el catálogo
  // ENTERO de la cuenta. Antes se buscaban en los 20 videos más nuevos que
  // devuelve la API, así que un comentario sobre un video de hace un mes
  // aparecía sin ninguna referencia a su video — que es justo el hilo donde
  // hace falta saber de qué están hablando.
  const { data } = await db
    .from("tiktok_videos")
    .select("caption, share_url")
    .eq("workspace_id", workspaceId)
    .eq("video_id", videoId)
    .maybeSingle();
  const guardado = data as { caption: string | null; share_url: string | null } | null;

  const salida: { permalink?: string; image?: string; caption?: string } = {
    permalink: guardado?.share_url ?? undefined,
    caption: guardado?.caption ?? undefined,
  };

  // La portada NO se guarda: TikTok la firma con vencimiento, así que una URL
  // vieja devuelve una imagen rota. Se pide en el momento y sólo alcanza a los
  // videos recientes; si no está, el banner se muestra igual con su texto.
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? "");
  if (!businessId) return salida;
  try {
    const token = await getFreshTikTokToken(connection);
    const fields = JSON.stringify(["item_id", "caption", "thumbnail_url", "share_url"]);
    const url =
      `https://business-api.tiktok.com/open_api/v1.3/business/video/list/` +
      `?business_id=${encodeURIComponent(businessId)}` +
      `&fields=${encodeURIComponent(fields)}&max_count=20`;
    const r = await fetch(url, { headers: { "Access-Token": token } });
    const j = (await r.json().catch(() => ({}))) as {
      code?: number;
      data?: { videos?: Array<Record<string, unknown>> };
    };
    if (!r.ok || (j.code ?? 0) !== 0) return conPortadaPublica(salida);
    const v = (j.data?.videos ?? []).find(
      (x) => String(x.item_id ?? x.video_id ?? "") === videoId,
    );
    if (!v) return conPortadaPublica(salida);
    return {
      permalink: String(v.share_url ?? "") || salida.permalink,
      image: String(v.thumbnail_url ?? "") || undefined,
      caption: String(v.caption ?? "") || salida.caption,
    };
  } catch {
    return conPortadaPublica(salida);
  }
}

/**
 * La portada de un video que ya no está entre los 20 más nuevos.
 *
 * La API de negocios sólo devuelve `thumbnail_url` en el listado, y ese
 * listado se acota. El oEmbed público de TikTok da la portada de CUALQUIER
 * video con su enlace y sin credenciales, que es exactamente lo que falta
 * para que un hilo sobre un video viejo no aparezca sin imagen.
 */
async function conPortadaPublica(salida: {
  permalink?: string;
  image?: string;
  caption?: string;
}): Promise<{ permalink?: string; image?: string; caption?: string }> {
  if (salida.image || !salida.permalink) return salida;
  try {
    const r = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(salida.permalink)}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) return salida;
    const j = (await r.json().catch(() => ({}))) as {
      thumbnail_url?: string;
      title?: string;
    };
    return {
      ...salida,
      image: j.thumbnail_url || undefined,
      caption: salida.caption || j.title || undefined,
    };
  } catch {
    return salida;
  }
}
