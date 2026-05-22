import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * POST /api/workspace/invite
 *
 * Body: { workspace_id: string; email: string; role: 'admin' | 'agent' }
 *
 * Authorization: caller must be an admin of the workspace. Creates a
 * `workspace_invites` row with a 14-day token. The invite email itself
 * is delivered via Supabase Auth's invite-by-email flow (which the
 * frontend stitches to the accept-invite page via the `?invite_token=…`
 * query string). When email delivery is wired in Phase 9, this row
 * becomes the canonical record of pending invites.
 */
export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { workspace_id?: string; email?: string; role?: "admin" | "agent" }
    | null;
  if (!body?.workspace_id || !body.email?.trim()) {
    return NextResponse.json({ error: "workspace_id + email required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", body.workspace_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const { error } = await admin.from("workspace_invites").insert({
    workspace_id: body.workspace_id,
    email: body.email.trim().toLowerCase(),
    role: body.role ?? "agent",
    token,
    invited_by: user.id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // TODO Phase 9: actually email the recipient with the accept-invite link.
  const acceptUrl = new URL(req.url);
  acceptUrl.pathname = `/invite/${token}`;
  acceptUrl.search = "";

  return NextResponse.json({ ok: true, accept_url: acceptUrl.toString() });
}
