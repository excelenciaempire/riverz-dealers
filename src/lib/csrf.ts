/**
 * Double-submit-cookie CSRF protection.
 *
 * Why double-submit and not synchronizer-token: the synchronizer pattern
 * needs a server-side store keyed by session, which means an extra
 * Supabase round-trip on every state-changing call. Double-submit lives
 * entirely in the cookie + a matching request header — same security
 * guarantee for browser CSRF (an attacker on origin X can set neither
 * our cookies on riverz nor read them), zero database hits.
 *
 * The cookie is HttpOnly:false on purpose: the React client needs to
 * read it to echo the token in the x-csrf-token header. The "secret" is
 * not the token itself (any same-origin script can see it) — it is the
 * fact that cross-origin scripts cannot read our cookies.
 */
import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "csrf";
const TOKEN_BYTES = 32;

export function generateCsrfToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

export async function getOrSetCsrfCookie(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const token = generateCsrfToken();
  jar.set(COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return token;
}

/**
 * Convenience helper for route handlers: returns a 403 NextResponse if
 * the CSRF check fails, or null if it passes. Lets call sites do:
 *
 *   const block = await csrfGuard(req);
 *   if (block) return block;
 */
export async function csrfGuard(req: Request) {
  const ok = await verifyCsrfHeader(req);
  if (ok) return null;
  const { NextResponse } = await import("next/server");
  return NextResponse.json({ error: "csrf_mismatch" }, { status: 403 });
}

export async function verifyCsrfHeader(req: Request): Promise<boolean> {
  const header = req.headers.get("x-csrf-token");
  if (!header) return false;

  // Prefer the request's own cookie header so the check works in route
  // handlers that haven't yet awaited cookies(); fall back to the cookie
  // jar (used in tests / non-route contexts).
  let cookieValue: string | undefined;
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === COOKIE_NAME) {
        cookieValue = rest.join("=");
        break;
      }
    }
  }
  if (!cookieValue) {
    try {
      const jar = await cookies();
      cookieValue = jar.get(COOKIE_NAME)?.value;
    } catch {
      // cookies() throws outside a request scope; treat as missing.
    }
  }
  if (!cookieValue) return false;
  if (cookieValue.length !== header.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(cookieValue),
      Buffer.from(header),
    );
  } catch {
    return false;
  }
}
