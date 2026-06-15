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
 *
 * Anti-enumeration: every failure path returns the SAME body and the
 * handler always blocks for a fixed minimum so DB-lookup timing can't
 * be used to distinguish "no such email" from "wrong password".
 */

const GENERIC_FAIL = {
  error: "credenciales_invalidas",
  message: "Email o contraseña incorrectos.",
} as const;
const MIN_RESPONSE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failResponse(status = 401) {
  return NextResponse.json(GENERIC_FAIL, { status });
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = async <T>(value: T): Promise<T> => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
    return value;
  };

  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  if (!email || !password) {
    return finish(failResponse(400));
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
    return finish(failResponse(401));
  }
  return finish(NextResponse.json({ ok: true }));
}
