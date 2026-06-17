import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";

/**
 * DELETE /api/conversations/:id
 *
 * Removes a conversation and all its messages from the workspace inbox.
 * Mirrors `/api/messages/:id` semantics: this is a "delete from inbox"
 * only — the upstream platform (WhatsApp, Gmail, IG, etc.) isn't
 * touched, so the contact can still send new messages and a fresh
 * conversation will be created the next time inbox-writer sees a
 * message from them.
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

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conv.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Messages are CASCADE-deleted via the FK in 001_initial_schema.sql.
  const { error } = await admin.from("conversations").delete().eq("id", id);
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ ok: true });
}
