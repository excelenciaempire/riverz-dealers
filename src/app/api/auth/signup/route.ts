import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { safeRedirectTo } from "@/lib/auth/redirect";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

/**
 * POST /api/auth/signup
 *
 * Wraps supabase.auth.signUp with per-IP + per-email rate limiting so
 * the auth page can keep its UX (browser-driven) while we still cap
 * mass-registration probes. The verification email goes out through
 * Supabase as usual.
 *
 * Anti-enumeration: on email collision we do NOT say "already
 * registered". Instead we silently fire a password-reset email to that
 * address (so the real owner can recover the account) and return the
 * same generic message used on a normal sign-up. Probes can't tell the
 * two branches apart.
 */

export async function POST(req: Request) {
  const locale = await getLocale();
  const genericOk = {
    ok: true,
    message: translate(locale, "errAccount.signupGenericOk"),
  } as const;

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
    return NextResponse.json(genericOk);
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-signup:ip:${ip}`, RATE_LIMITS.auth);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-signup:email:${email}`,
    RATE_LIMITS.auth,
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  // Defence-in-depth: only honor a `redirect_to` whose origin matches
  // this app's own NEXT_PUBLIC_SITE_URL. Anything else (open-redirect
  // attempt) is silently coerced to undefined so Supabase falls back
  // to its project-default Site URL.
  const redirectTo = safeRedirectTo(body?.redirect_to);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: redirectTo,
    },
  });

  // Supabase signals an existing-confirmed-user collision in one of two
  // ways depending on project settings: a hard error, or a "fake" user
  // object with no identities. Either way we treat it as collision and
  // send the real owner a recovery link instead of leaking the fact.
  const isCollision =
    !!error || (data?.user?.identities?.length ?? 1) === 0;
  if (isCollision) {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
  }
  return NextResponse.json(genericOk);
}
