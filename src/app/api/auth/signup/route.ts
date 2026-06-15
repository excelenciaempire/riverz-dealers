import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/signup
 *
 * Wraps supabase.auth.signUp with per-IP + per-email rate limiting so
 * the auth page can keep its UX (browser-driven) while we still cap
 * mass-registration probes. The verification email goes out through
 * Supabase as usual.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        email?: string;
        password?: string;
        full_name?: string;
        redirect_to?: string;
      }
    | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  const fullName = body?.full_name?.trim() ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email y contraseña requeridos" },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-signup:ip:${ip}`, RATE_LIMITS.auth);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-signup:email:${email}`,
    RATE_LIMITS.auth,
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: body?.redirect_to,
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
