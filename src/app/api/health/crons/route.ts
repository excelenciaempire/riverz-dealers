import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { assertCronAuth } from '@/lib/auth/cron'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Cron liveness + webhook-capture view, backed by the `cron_runs` and
 * `webhook_events_raw` tables (migration 059).
 *
 * Antes esto reducía en JS las últimas 500 filas de `cron_runs`. Con ~34
 * trabajos, seis de ellos cada minuto, esa ventana cubre menos de una hora: los
 * trabajos diarios (`pii-purge`, `issues-alert`, `reengagement`), los de 6 h y
 * los de 12 h quedaban fuera de la respuesta la mayor parte del tiempo, y un
 * cron ausente era indistinguible de uno muerto. Ahora usa el mismo
 * `admin_cron_health` que el panel — `DISTINCT ON (name)` sobre toda la tabla,
 * con el índice `(name, started_at DESC)` que ya existe — así que las dos
 * pantallas no pueden contradecirse.
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

  const [{ data: crons }, { count: unprocessedWebhooks }] = await Promise.all([
    admin.rpc('admin_cron_health'),
    admin
      .from('webhook_events_raw')
      .select('id', { count: 'exact', head: true })
      .is('processed_at', null),
  ])

  return NextResponse.json(
    {
      crons: crons ?? [],
      unprocessed_webhooks: unprocessedWebhooks ?? 0,
      ts: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
