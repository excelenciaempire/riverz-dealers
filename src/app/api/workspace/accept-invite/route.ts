import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * POST /api/workspace/accept-invite
 *
 * Body: { token: string }
 *
 * Looks up the invite by token, confirms it hasn't expired, and creates
 * the membership for the authenticated user. The recipient email is NOT
 * compared against the user's auth email — invites are link-bearer
 * tokens by design (anyone with the URL can claim it). The token is
 * 192-bit random so guessing is not a concern.
 */
export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("*")
    .eq("token", body.token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 409 });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  // Idempotent: if the user is already a member just mark the invite as
  // accepted and return success.
  const { data: existing } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    const { error: insErr } = await admin.from("workspace_members").insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
      invited_email: invite.email,
      invited_by: invite.invited_by,
    });
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }
  }

  await admin
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return NextResponse.json({ ok: true, workspace_id: invite.workspace_id });
}
