import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { assertCronAuth } from '@/lib/auth/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Cron liveness + webhook-capture view, backed by the `cron_runs` and
 * `webhook_events_raw` tables (migration 059). Returns the latest run per
 * cron name and a count of unprocessed captured webhook deliveries.
 *
 * Auth: same `x-cron-secret` (AUTOMATION_CRON_SECRET) as the crons — this
 * exposes operational internals, so it isn't public.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  // Latest run per cron name. We pull a recent window and reduce to the
  // newest per name client-side — simpler than a DISTINCT ON RPC and the
  // table is small (one row per cron run, pruned by ops as needed).
  const { data: runs } = await admin
    .from('cron_runs')
    .select('name, status, started_at, finished_at, duration_ms, error')
    .order('started_at', { ascending: false })
    .limit(500)

  const latestByName = new Map<
    string,
    {
      name: string
      status: string
      started_at: string
      finished_at: string | null
      duration_ms: number | null
      error: string | null
    }
  >()
  for (const r of (runs ?? []) as Array<{
    name: string
    status: string
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    error: string | null
  }>) {
    if (!latestByName.has(r.name)) latestByName.set(r.name, r)
  }

  const { count: unprocessedWebhooks } = await admin
    .from('webhook_events_raw')
    .select('id', { count: 'exact', head: true })
    .is('processed_at', null)

  return NextResponse.json(
    {
      crons: [...latestByName.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      unprocessed_webhooks: unprocessedWebhooks ?? 0,
      ts: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
