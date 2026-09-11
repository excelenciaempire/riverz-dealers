import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resilientDatabaseFetch } from '@/lib/db/resilient-fetch'

// Lazy, shared service-role client for automation engine work.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient

  _adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: resilientDatabaseFetch } },
  )
  return _adminClient
}
