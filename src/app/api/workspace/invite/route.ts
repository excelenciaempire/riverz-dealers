import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";

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
  const block = await csrfGuard(req);
  if (block) return block;
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
  // Surface a clear 400 when the email is malformed. The accept gate
  // does case-insensitive equality, so an invite for "not-an-email"
  // would just be unredeemable. Better to reject up-front.
  const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailShape.test(body.email.trim())) {
    return NextResponse.json({ error: "Correo inválido" }, { status: 400 });
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
  const email = body.email.trim().toLowerCase();
  const { error } = await admin.from("workspace_invites").insert({
    workspace_id: body.workspace_id,
    email,
    role: body.role ?? "agent",
    token,
    invited_by: user.id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const acceptUrl = new URL(req.url);
  acceptUrl.pathname = `/invitacion/${token}`;
  acceptUrl.search = "";

  // Delivery. Supabase Auth has a transactional invite endpoint; we use
  // it when SMTP is configured (Supabase project has either a custom
  // SMTP server or is below the built-in free quota). On a vanilla
  // self-hosted instance with no SMTP wired, inviteUserByEmail returns
  // a 500. We swallow that and log the bearer link so an operator can
  // hand-deliver — see CLAUDE.md note "SMTP not configured in dev".
  let mailDelivered = false;
  try {
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: acceptUrl.toString(),
        data: { workspace_id: body.workspace_id, invite_token: token },
      },
    );
    if (!inviteErr) mailDelivered = true;
    else
      console.warn("[workspace/invite] inviteUserByEmail failed:", inviteErr.message);
  } catch (e) {
    console.warn("[workspace/invite] inviteUserByEmail threw:", e);
  }

  if (!mailDelivered) {
    console.info(
      `[workspace/invite] would-send-invite-to=${email} link=${acceptUrl.toString()} (SMTP not configured)`,
    );
  }

  return NextResponse.json({
    ok: true,
    accept_url: acceptUrl.toString(),
    mail_delivered: mailDelivered,
  });
}
