import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/reset-password
 *
 * Sends the password-recovery email. Rate-limited 5/5min per IP and
 * per email so an attacker can't enumerate accounts or hammer the
 * Supabase mail quota.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; redirect_to?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email requerido" }, { status: 400 });
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-reset:ip:${ip}`, RATE_LIMITS.auth);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-reset:email:${email}`,
    RATE_LIMITS.auth,
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: body?.redirect_to,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
