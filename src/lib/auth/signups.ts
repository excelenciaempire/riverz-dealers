/**
 * Pre-launch gate: account creation is CLOSED.
 *
 * Riverz is in pre-launch — the landing offers a waitlist instead of a
 * sign-up form (see `src/app/api/waitlist/route.ts`). This flag closes the
 * three code paths that can mint a Supabase `auth.users` row:
 *
 *   1. `POST /api/auth/signup`            → 403
 *   2. `POST /api/workspace/invite`       → 403 (calls inviteUserByEmail)
 *   3. `/registro` + `/signup` page       → redirected to the landing in `proxy.ts`
 *
 * Existing users keep signing in, recovering passwords and confirming email
 * as usual — nothing here touches `/ingresar`, `/recuperar-clave`,
 * `/nueva-clave` or `/auth/callback`.
 *
 * To reopen: set `NEXT_PUBLIC_RIVERZ_SIGNUPS=open` and redeploy. The var is
 * NEXT_PUBLIC_ on purpose — the login page reads it in the browser to decide
 * whether to show the "create account" link, and the value is not a secret.
 *
 * NOTE: this closes Riverz's own routes. Supabase's `/auth/v1/signup`
 * endpoint is reachable directly with the public anon key, so the full
 * lock also needs "Allow new users to sign up" turned OFF in the Supabase
 * dashboard (Authentication → Sign In / Providers → Email).
 */
export function signupsOpen(): boolean {
  return process.env.NEXT_PUBLIC_RIVERZ_SIGNUPS === "open";
}
