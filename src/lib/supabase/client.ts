import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { COMMERCE_AUTH_COOKIE, selectedCommerceInBrowser } from '@/lib/auth/commerce-cookies'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined
let actorClient: SupabaseClient | undefined

function makeClient(commerce = false) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false, ...(commerce ? { cookieOptions: { name: COMMERCE_AUTH_COOKIE } } : {}) },
  )
}

export function createActorClient() {
  return actorClient ??= makeClient()
}

export function createClient() {
  if (browserClient) return browserClient

  browserClient = selectedCommerceInBrowser() ? makeClient(true) : createActorClient()

  return browserClient
}
