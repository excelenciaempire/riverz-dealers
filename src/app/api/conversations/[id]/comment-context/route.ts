import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { fetchPostComments } from "@/lib/channels/meta-graph";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { ChannelConnection, Conversation } from "@/types";

/**
 * GET /api/conversations/:id/comment-context
 *
 * For a FB/IG comment thread, reads the customer comments left on the
 * post/media straight from the Graph API (user-generated content). This
 * is the live read that exercises `pages_read_user_content` (FB) /
 * `instagram_manage_comments` (IG), and lets the inbox show the comment
 * thread in context.
 *
 * Best-effort: returns `{ comments: [] }` whenever nothing can be
 * resolved so the thread view never breaks (mirrors post-preview).
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
    conversation.channel !== "ig_comment"
  ) {
    return NextResponse.json({ comments: [] });
  }
  const postId = conversation.thread_external_id;
  if (!postId || !conversation.connection_id)
    return NextResponse.json({ comments: [] });

  const { data: connRow } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", conversation.connection_id)
    .maybeSingle();
  if (!connRow) return NextResponse.json({ comments: [] });
  const connection = connRow as ChannelConnection;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!enc) return NextResponse.json({ comments: [] });
  const token = decrypt(enc);

  const comments = await fetchPostComments(token, postId, conversation.channel);
  return NextResponse.json({ comments: comments ?? [] });
}
