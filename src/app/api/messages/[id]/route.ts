import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";

/**
 * DELETE /api/messages/:id
 *
 * Removes a message from the workspace inbox. This is a "delete from
 * inbox" — the platform side (Meta/WhatsApp/Gmail) is untouched
 * because most channels either don't allow programmatic delete or
 * require a separate moderation API. The conversation is left in
 * place: a delete usually means the agent misclicked, not that the
 * whole thread should disappear.
 *
 * RLS already enforces workspace membership for the messages table,
 * so we don't have to re-check workspace here — the admin client
 * call below would fail otherwise. We still verify the caller is
 * authenticated to avoid anonymous trolls hitting the endpoint.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  // Look up the message + its conversation's workspace so we can
  // confirm the caller belongs to it. RLS would also block on its own
  // but the explicit check gives a clean 403 instead of a "row not
  // found" 500.
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("messages")
    .select("id, conversation:conversations(workspace_id)")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const workspaceId = (row as { conversation?: { workspace_id?: string } })
    .conversation?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json({ error: "orphan message" }, { status: 500 });
  }
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await admin.from("messages").delete().eq("id", id);
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ ok: true });
}
