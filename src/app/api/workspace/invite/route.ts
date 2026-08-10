import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { sanitizeSections } from "@/lib/rbac/sections";
import { signupsOpen } from "@/lib/auth/signups";

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
  const locale = await getLocale();

  // Pre-launch: inviteUserByEmail (below) mints a real auth.users row, so
  // this route creates accounts just like /api/auth/signup. Closed with it.
  if (!signupsOpen()) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.invitesClosed") },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errAccount.unauthorized") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as
    | {
        workspace_id?: string;
        email?: string;
        role?: "admin" | "agent";
        /** RBAC: pre-assigned menu sections. Omit / null = full access. */
        allowed_sections?: string[] | null;
      }
    | null;
  if (!body?.workspace_id || !body.email?.trim()) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteFieldsRequired") },
      { status: 400 },
    );
  }
  // Surface a clear 400 when the email is malformed. The accept gate
  // does case-insensitive equality, so an invite for "not-an-email"
  // would just be unredeemable. Better to reject up-front.
  const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailShape.test(body.email.trim())) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.emailInvalid") },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: translate(locale, "errAccount.inviteAdminOnly") },
      { status: 403 },
    );
  }

  const token = crypto.randomBytes(24).toString("hex");
  const email = body.email.trim().toLowerCase();
  const role = body.role ?? "agent";
  // Admins always have full access. For agents: an explicit array restricts to
  // those sections; null / omitted stays full access (no footgun on a plain
  // invite). '{}' (empty, provided) means "no sections" — an explicit choice.
  const allowedSections =
    role === "admin" || body.allowed_sections == null
      ? null
      : sanitizeSections(body.allowed_sections);
  const { error } = await admin.from("workspace_invites").insert({
    workspace_id: body.workspace_id,
    email,
    role,
    token,
    invited_by: user.id,
    allowed_sections: allowedSections,
  });
  if (error) {
    return serverError(
      error,
      translate(locale, "errAccount.createInviteFailed"),
      400,
    );
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
    // No logueamos el token/accept-link en prod: es el secreto bearer del
    // flujo de invitación y quedaría en logs. El accept_url ya viaja en la
    // respuesta JSON al admin autenticado para hand-delivery. En dev sí lo
    // mostramos para poder probar sin SMTP.
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[workspace/invite] would-send-invite-to=${email} link=${acceptUrl.toString()} (SMTP not configured)`,
      );
    } else {
      console.info(
        `[workspace/invite] invite created for=${email} (SMTP not configured; accept_url devuelto en la respuesta)`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    accept_url: acceptUrl.toString(),
    mail_delivered: mailDelivered,
  });
}
