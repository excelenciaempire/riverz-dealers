import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { getLogger } from "@/lib/log/logger";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

const log = getLogger("workspace.accept-invite");

/**
 * POST /api/workspace/accept-invite
 *
 * Body: { token: string }
 *
 * Email-match enforcement gate — added after security audit (wave 9
 * patch 3). Do not remove without a replacement (cryptographic
 * challenge, etc.). An attacker who phishes the bearer URL must not
 * be able to claim a workspace seat under a different identity, so
 * we require:
 *   a) the caller is signed in,
 *   b) the caller's email is confirmed (email_confirmed_at present),
 *   c) the caller's email (case-insensitive, trimmed) matches the
 *      invite.email recorded by the inviter,
 *   d) the invite has not expired,
 *   e) the invite has not been consumed (accepted_at IS NULL).
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.notSignedIn") },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.tokenRequired") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("*")
    .eq("token", body.token)
    .maybeSingle();

  if (!invite) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteInvalid") },
      { status: 404 },
    );
  }
  if (invite.accepted_at) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteAlreadyUsed") },
      { status: 409 },
    );
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteExpired") },
      { status: 410 },
    );
  }

  // (b) The caller must have confirmed their email. Supabase exposes
  // email_confirmed_at on auth.users; the middleware also forces the
  // user through /verificar-email but we re-check here so the API is
  // self-defending.
  if (!user.email_confirmed_at && !user.confirmed_at) {
    return NextResponse.json(
      {
        error: translate(locale, "errAccount.verifyEmailFirst"),
      },
      { status: 403 },
    );
  }

  // (c) Email-match gate. Compare case-insensitive + trimmed.
  const userEmail = (user.email ?? "").trim().toLowerCase();
  const inviteEmail = (invite.email ?? "").trim().toLowerCase();
  if (!userEmail || userEmail !== inviteEmail) {
    const [localPart] = inviteEmail.split("@");
    const masked = localPart
      ? `${localPart.slice(0, 2)}…@…`
      : translate(locale, "errAccount.invitedAddressFallback");
    log.warn("invite email mismatch", {
      invite_id: invite.id,
      workspace_id: invite.workspace_id,
      user_id: user.id,
    });
    return NextResponse.json(
      {
        error: translate(locale, "errAccount.inviteForOtherAccount", { masked }),
      },
      { status: 403 },
    );
  }

  // Idempotent: if the user is already a member just mark the invite
  // as consumed and return success.
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
      log.error("workspace_members insert failed", {
        invite_id: invite.id,
        workspace_id: invite.workspace_id,
        user_id: user.id,
        error: insErr.message,
      });
      return NextResponse.json(
        { error: translate(locale, "errAccount.joinWorkspaceFailed") },
        { status: 400 },
      );
    }
  }

  await admin
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  log.info("invite accepted", {
    invite_id: invite.id,
    workspace_id: invite.workspace_id,
    user_id: user.id,
    role: invite.role,
  });

  return NextResponse.json({ ok: true, workspace_id: invite.workspace_id });
}
