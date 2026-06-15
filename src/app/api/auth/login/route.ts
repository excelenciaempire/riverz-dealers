import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/login
 *
 * Server-side wrapper around supabase.auth.signInWithPassword. Exists
 * so we can apply per-IP + per-email rate limiting (5/5min) before the
 * call reaches Supabase. The browser sets the auth cookies on the
 * response automatically via the SSR cookie adapter.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email y contraseña requeridos" },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-login:ip:${ip}`, RATE_LIMITS.auth);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-login:email:${email}`,
    RATE_LIMITS.auth,
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
