import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { recordLegalConsent } from "@/lib/legal/consent";
import { LEGAL_VERSION } from "@/lib/legal/version";
import { csrfGuard } from "@/lib/csrf";

/**
 * POST /api/legal/reconsent
 *
 * Records a fresh Terms & Privacy acceptance for the signed-in user at the
 * CURRENT LEGAL_VERSION. Fired by the re-consent modal that blocks the app
 * when the user's recorded version is older than the docs in force. Writes the
 * same append-only audit row + profile mirror as signup/invite, tagged with
 * context "reconsent" so the acceptance trail stays complete.
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  await recordLegalConsent({
    admin: supabaseAdmin(),
    userId: user.id,
    email: (user.email ?? "").trim().toLowerCase(),
    version: LEGAL_VERSION,
    context: "reconsent",
    req,
  });

  return NextResponse.json({ ok: true });
}
