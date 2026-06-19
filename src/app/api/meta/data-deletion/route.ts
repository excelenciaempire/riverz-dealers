import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { parseSignedRequest, requestOrigin } from "@/lib/channels/signed-request";

/**
 * POST /api/meta/data-deletion
 *
 * Meta Data Deletion Request Callback. When a person removes our app or
 * requests deletion of their data, Meta POSTs a `signed_request`. We:
 *   1. verify it with the app secret,
 *   2. delete any data tied to that Meta user id (contacts + their
 *      conversations/messages cascade) across the Meta channels,
 *   3. return { url, confirmation_code } so the person can check status.
 *
 * Public + un-CSRF'd by design (Meta calls it server-to-server; the
 * signed_request HMAC is the authentication). Always returns 200 with a
 * code once the request is verified, even if there was nothing to delete.
 *
 * Docs: https://developers.facebook.com/docs/development/data-deletion-request-callback/
 */
export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed !== "string") {
    return NextResponse.json({ error: "missing_signed_request" }, { status: 400 });
  }

  const data = parseSignedRequest(signed, secret);
  if (!data?.user_id) {
    return NextResponse.json({ error: "invalid_signed_request" }, { status: 400 });
  }
  const userId = String(data.user_id);

  // Best-effort deletion. Contacts cascade to conversations + messages
  // (FK ON DELETE CASCADE). Scope to the Meta channels so a coincidental
  // id from another channel is never touched. Never throw — Meta needs a
  // 200 with the confirmation code regardless.
  try {
    await supabaseAdmin()
      .from("contacts")
      .delete()
      .eq("external_id", userId)
      .in("channel", ["messenger", "instagram", "fb_comment", "ig_comment"]);
  } catch {
    // swallow — still acknowledge with a code; deletion is reconciled async.
  }

  const code = `del_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  return NextResponse.json({
    url: `${requestOrigin(req)}/eliminar-datos?code=${code}`,
    confirmation_code: code,
  });
}
