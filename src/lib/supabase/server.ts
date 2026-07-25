import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// SameSite=lax: the cookie travels on top-level GET navigations (clicking
// a link, OAuth provider redirects back to us) but is BLOCKED on cross-site
// POST/PUT/DELETE — which is exactly the CSRF surface we care about. We
// also have explicit CSRF tokens on every mutation (see lib/csrf.ts), so
// lax is the right balance. SameSite=strict broke every OAuth callback
// (Microsoft, Google, Meta Embedded Signup) because providers redirect us
// from their domain back to ours via a top-level GET — the browser
// strips the strict cookie on that hop, our callback can't find the
// signed-in user, and we bounce out with "not signed in".
//
// NOTE: httpOnly is intentionally NOT forced here. @supabase/ssr's
// browser client reads the session cookie from JS to populate
// `supabase.auth.getSession()` on the client side. Setting httpOnly=true
// blinds the browser to its own session → dashboard-shell sees
// `user === null` → returns null → blank page. Server-side reads via
// `await cookies()` work either way. The XSS surface is mitigated by
// (a) strict CSP with nonce + 'strict-dynamic' (no inline scripts), and
// (b) the CSRF token double-submit on every mutation.
//
// Sessions never expire on their own: they end only when the user signs out
// (or revokes sessions from Settings). @supabase/ssr stamps maxAge=400 days
// on the cookie and refreshes the 1h access token silently, and Supabase Auth
// keeps sessions_timebox / sessions_inactivity_timeout at 0. Don't add an
// idle-timeout guard on top — it was removed on purpose.
export const SESSION_COOKIE_OPTIONS = {
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS })
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
