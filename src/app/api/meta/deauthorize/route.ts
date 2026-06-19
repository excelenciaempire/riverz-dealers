import { NextResponse } from "next/server";
import { parseSignedRequest } from "@/lib/channels/signed-request";

/**
 * POST /api/meta/deauthorize
 *
 * Meta Deauthorize Callback — fired when a person removes our app from
 * their Facebook/Instagram settings. We verify the signed_request and
 * acknowledge. Data removal itself is handled by the Data Deletion
 * callback (see ./data-deletion); this endpoint exists so the app has a
 * valid, verified deauthorize URL to configure in Facebook Login settings.
 *
 * Public + un-CSRF'd by design (server-to-server; signed_request is auth).
 */
export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: true });
  }
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed === "string") {
    // Verify but don't fail the ack — Meta expects a 200.
    parseSignedRequest(signed, secret);
  }
  return NextResponse.json({ ok: true });
}
