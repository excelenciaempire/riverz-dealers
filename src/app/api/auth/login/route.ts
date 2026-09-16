import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/auth/login
 *
 * Server-side wrapper around supabase.auth.signInWithPassword. Exists
 * so we can apply per-IP + per-email rate limiting (10 cada 3 min) before the
 * call reaches Supabase. The browser sets the auth cookies on the
 * response automatically via the SSR cookie adapter.
 *
 * Anti-enumeration: every failure path returns the SAME body and the
 * handler always blocks for a fixed minimum so DB-lookup timing can't
 * be used to distinguish "no such email" from "wrong password".
 */

const MIN_RESPONSE_MS = 300;
const AUTH_TIMEOUT_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failResponse(message: string, status = 401) {
  return NextResponse.json(
    { error: 'credenciales_invalidas', message },
    { status }
  );
}

function unavailableResponse(message: string) {
  return NextResponse.json(
    { error: 'servicio_no_disponible', message },
    { status: 503, headers: { 'Retry-After': '30' } }
  );
}

const loginFetch: typeof globalThis.fetch = (input, init) => {
  const timeout = AbortSignal.timeout(AUTH_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, { ...init, signal });
};

export async function POST(req: Request) {
  const locale = await getLocale();
  const failMessage = translate(locale, 'errAccount.invalidCredentials');
  const unavailableMessage = translate(locale, 'errAccount.loginUnavailable');
  const startedAt = Date.now();
  const finish = async <T>(value: T): Promise<T> => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
    return value;
  };

  const body = (await req.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  if (!email || !password) {
    return finish(failResponse(failMessage, 400));
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-login:ip:${ip}`, RATE_LIMITS.login);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-login:email:${email}`,
    RATE_LIMITS.login
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  const supabase = await createClient({ fetch: loginFetch });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (
      error.name === 'AuthRetryableFetchError' ||
      error.name === 'AbortError' ||
      error.status === 0 ||
      (typeof error.status === 'number' && error.status >= 500)
    ) {
      return finish(unavailableResponse(unavailableMessage));
    }
    return finish(failResponse(failMessage, 401));
  }
  return finish(NextResponse.json({ ok: true }));
}
