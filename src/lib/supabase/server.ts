import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createMockClient } from '@/lib/demo/mock-client'
import { isDemoMode } from '@/lib/demo'

// SameSite=strict blocks the browser from attaching the auth cookie to
// ANY cross-site request (including top-level navigations from external
// links). On a dashboard app this trades a small UX loss — clicking a
// link to /panel from an outside site won't carry the session, so the
// user lands on /ingresar — for full CSRF immunity on top of the
// existing CSRF tokens. The default from @supabase/ssr is 'lax', which
// still allows GET top-level navigations and leaks just enough for some
// CSRF variants. Override it via the cookieOptions on every client.
export const SESSION_COOKIE_OPTIONS = {
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  path: '/',
} as const

export async function createClient() {
  if (isDemoMode()) {
    return createMockClient() as unknown as ReturnType<typeof createServerClient>
  }

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
