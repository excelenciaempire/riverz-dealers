import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { resolveWorkspaceKey } from '@/lib/integrations/workspace-key'
import {
  KlaviyoUnauthorizedError,
  syncWorkspaceToKlaviyo,
} from '@/lib/integrations/klaviyo'
import { syncWorkspaceEvents } from '@/lib/integrations/klaviyo-events'
import { syncKlaviyoSegments } from '@/lib/integrations/klaviyo-segments'
import { syncKlaviyoOptOuts } from '@/lib/integrations/klaviyo-optout'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.klaviyo-sync')

/**
 * Espeja la base de contactos de cada workspace con Klaviyo conectado.
 *
 * Cada 15 minutos y por marca de agua: la primera corrida sube la base entera
 * y las siguientes sólo lo que cambió, así que el trabajo real es chico.
 *
 * La marca (`last_sync_at`) se escribe aunque la corrida falle: es "cuándo lo
 * intentamos", y ordenar por ella hace rotar la cola entre workspaces en vez
 * de reintentar siempre el mismo roto primero.
 */
const MAX_WORKSPACES = 10

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  const { data, error } = await admin
    .from('workspace_integrations')
    .select('workspace_id, last_sync_at')
    .eq('provider', 'klaviyo')
    .eq('is_active', true)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(MAX_WORKSPACES)

  if (error) return serverError(error)
  const rows = (data ?? []) as { workspace_id: string; last_sync_at: string | null }[]
  if (rows.length === 0) return NextResponse.json({ workspaces: 0 })

  let ok = 0
  let failed = 0
  const totals = {
    scanned: 0,
    synced: 0,
    suppressed: 0,
    skipped: 0,
    events: 0,
    segments: 0,
    tagged: 0,
    untagged: 0,
    optedOut: 0,
  }

  for (const row of rows) {
    const apiKey = await resolveWorkspaceKey(
      admin,
      row.workspace_id,
      'klaviyo',
      process.env.KLAVIYO_API_KEY,
    )
    if (!apiKey) {
      failed++
      continue
    }

    try {
      // 1. Los contactos, con sus etiquetas y sus bajas.
      const res = await syncWorkspaceToKlaviyo(admin, {
        workspaceId: row.workspace_id,
        apiKey,
        since: row.last_sync_at,
      })
      totals.scanned += res.scanned
      totals.synced += res.synced
      totals.suppressed += res.suppressed
      totals.skipped += res.skipped

      // 2. Lo que pasó: compras, carritos, pagos rechazados y conversación.
      //    Es lo que dispara sus flujos y lo que le atribuye la plata.
      const events = await syncWorkspaceEvents(admin, {
        workspaceId: row.workspace_id,
        apiKey,
        since: row.last_sync_at,
      })
      totals.events += events.sent

      // 3. Sus segmentos, de vuelta como etiquetas de Riverz.
      const ownerUserId = await resolveWorkspaceOwnerUserId(admin, row.workspace_id)
      const segments = await syncKlaviyoSegments(admin, {
        workspaceId: row.workspace_id,
        apiKey,
        ownerUserId,
      })
      totals.segments += segments.segments
      totals.tagged += segments.tagged
      totals.untagged += segments.untagged

      // 4. Quien se dio de baja allá deja de recibir WhatsApp acá.
      const outs = await syncKlaviyoOptOuts(admin, {
        workspaceId: row.workspace_id,
        apiKey,
        since: row.last_sync_at,
      })
      totals.optedOut += outs.optedOut

      ok++
    } catch (err) {
      // Clave revocada o rotada: no hay reintento que la arregle. Se
      // desactiva para dejar de golpear a Klaviyo cada 15 minutos, y la
      // tarjeta de Integraciones vuelve a "sin conectar" para que el
      // comercio pegue una nueva.
      if (err instanceof KlaviyoUnauthorizedError) {
        await admin
          .from('workspace_integrations')
          .update({ is_active: false })
          .eq('workspace_id', row.workspace_id)
          .eq('provider', 'klaviyo')
      } else {
        log.captureException(err, { workspaceId: row.workspace_id })
      }
      failed++
    } finally {
      await admin
        .from('workspace_integrations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('workspace_id', row.workspace_id)
        .eq('provider', 'klaviyo')
    }
  }

  return NextResponse.json({ workspaces: rows.length, ok, failed, ...totals })
}

export const GET = withCronRun('klaviyo-sync', cronHandler)
