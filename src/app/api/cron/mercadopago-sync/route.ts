import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { freshAccessToken } from '@/lib/mercadopago/oauth'
import { countryOfPhone } from '@/lib/whatsapp/phone-utils'
import { syncWorkspaceRejectedPayments } from '@/lib/mercadopago/sync'
import { withCronRun } from '@/lib/cron/heartbeat'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.mercadopago-sync')

/**
 * Trae los pagos rechazados de cada workspace con Mercado Pago conectado.
 *
 * Corre cada 30 minutos. No envía nada: sólo deja las filas en
 * `mp_rejected_payments`. El envío lo decide `mercadopago-recovery`, que
 * es quien conoce la espera configurada y quién ya compró.
 *
 * La ventana se pide con solape (7 días) porque un pago puede aparecer con
 * retraso y porque la ingesta es idempotente: repetir no duplica.
 */
const WINDOW_DAYS = 7

/** Tope por corrida, para que una cuenta grande no monopolice el tick. */
const MAX_WORKSPACES = 25

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
    .select('workspace_id')
    .eq('provider', 'mercadopago')
    .eq('is_active', true)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(MAX_WORKSPACES)

  if (error) return serverError(error)
  const rows = (data ?? []) as { workspace_id: string }[]
  if (rows.length === 0) return NextResponse.json({ workspaces: 0 })

  // El país se deduce del número de WhatsApp del propio comercio: sin él,
  // un móvil que el cliente escribió en formato local ("11 4496-0458") no
  // se puede llevar a E.164 y queda inalcanzable. Mismo criterio que usa
  // el módulo de voz para decidir cómo marcar.
  const { data: connRows } = await admin
    .from('channel_connections')
    .select('workspace_id, config')
    .eq('channel', 'whatsapp')
    .in(
      'workspace_id',
      rows.map((r) => r.workspace_id)
    )
  const countryOf = new Map<string, string>()
  for (const c of (connRows ?? []) as {
    workspace_id: string
    config?: { display_phone_number?: string } | null
  }[]) {
    const iso = countryOfPhone(c.config?.display_phone_number)
    if (iso) countryOf.set(c.workspace_id, iso)
  }

  let ok = 0
  let failed = 0
  const totals = { rejected: 0, people: 0, paid: 0, inserted: 0, pending: 0 }

  for (const row of rows) {
    // Renueva el token si está por vencer. Mercado Pago da 180 días y sólo
    // el flujo de autorización devuelve refresh: sin esto, una cuenta
    // conectada hace medio año deja de sincronizar sin ningún aviso.
    const token = await freshAccessToken(admin, row.workspace_id)
    if (!token) {
      // No se puede leer el secreto (rotó la clave de cifrado, o el valor se
      // corrompió). Se desactiva para no reintentar cada media hora contra
      // algo que no tiene arreglo automático.
      await admin
        .from('workspace_integrations')
        .update({ is_active: false })
        .eq('workspace_id', row.workspace_id)
        .eq('provider', 'mercadopago')
      failed++
      continue
    }

    try {
      const res = await syncWorkspaceRejectedPayments(admin, {
        workspaceId: row.workspace_id,
        token,
        windowDays: WINDOW_DAYS,
        defaultCountry: countryOf.get(row.workspace_id) ?? 'AR',
      })
      totals.rejected += res.rejected
      totals.people += res.people
      totals.paid += res.paid
      totals.inserted += res.ingested.inserted
      totals.pending += res.pending
      ok++
    } catch (err) {
      log.captureException(err, { workspaceId: row.workspace_id })
      failed++
    } finally {
      // Se marca incluso si falló: la marca es "cuándo lo intentamos", y
      // ordenar por ella es lo que hace rotar la cola entre workspaces en
      // vez de reintentar siempre el mismo roto primero.
      await admin
        .from('workspace_integrations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('workspace_id', row.workspace_id)
        .eq('provider', 'mercadopago')
    }
  }

  return NextResponse.json({ workspaces: rows.length, ok, failed, ...totals }, { status: failed ? 207 : 200 })
}

export const GET = withCronRun('mercadopago-sync', cronHandler)
