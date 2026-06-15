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
 * per email so an attacker can't hammer the Supabase mail quota.
 *
 * Anti-enumeration: the response shape is identical whether the email
 * exists or not, and Supabase errors are swallowed. Anyone polling the
 * endpoint sees the same "if the account exists…" line every time.
 */

const GENERIC_OK = {
  ok: true,
  message: "Si la cuenta existe, recibirás un correo con instrucciones.",
} as const;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; redirect_to?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(GENERIC_OK);
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
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: body?.redirect_to,
  });
  return NextResponse.json(GENERIC_OK);
}
