import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMockClient } from '@/lib/demo/mock-client'
import { isDemoMode } from '@/lib/demo'

// Lazy, shared service-role client for automation engine work.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient

  if (isDemoMode()) {
    _adminClient = createMockClient() as unknown as SupabaseClient
    return _adminClient
  }

  _adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return _adminClient
}
