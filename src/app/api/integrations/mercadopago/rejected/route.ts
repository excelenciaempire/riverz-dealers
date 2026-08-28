import { NextResponse } from 'next/server'
import { assertCronAuthAny } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  ingestRejectedPayments,
  statusOf,
  type RejectedPaymentInput,
} from '@/lib/mercadopago/rejected'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('integrations.mercadopago.rejected')

/**
 * Puente entre la hoja de contabilidad y Riverz para pagos rechazados.
 *
 *   POST  → la app de contabilidad empuja la lista de rechazados (ya
 *           agrupada por persona y cruzada con los carritos abandonados).
 *           Idempotente: se reenvía la lista completa cada corrida.
 *
 *   GET   → devuelve el estado de cada fila (contactado / recuperado /
 *           sin teléfono / omitido) para que la hoja lo pinte en sus
 *           columnas. Es la única fuente de esas columnas: la hoja se
 *           reescribe entera en cada ciclo, así que cualquier cosa
 *           tipeada a mano ahí se borraría sola.
 *
 * Autenticación: `x-cron-secret`, el mismo secreto que ya usan los crons.
 * No hay sesión de usuario detrás de esta llamada — es servidor a servidor.
 */

/** Tope por request. Evita que un backfill de meses tumbe la corrida. */
const MAX_PAYMENTS = 1000

function parseWorkspaceId(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null
}

async function assertWorkspace(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .maybeSingle()
  return Boolean(data)
}

export async function POST(request: Request) {
  try {
    assertCronAuthAny(request, ['AUTOMATION_CRON_SECRET', 'CRON_SECRET'])
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const workspaceId = parseWorkspaceId(body.workspace_id)
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }

  const payments = Array.isArray(body.payments)
    ? (body.payments as RejectedPaymentInput[])
    : null
  if (!payments) {
    return NextResponse.json({ error: 'payments_required' }, { status: 400 })
  }
  if (payments.length > MAX_PAYMENTS) {
    return NextResponse.json(
      { error: 'too_many_payments', max: MAX_PAYMENTS },
      { status: 413 },
    )
  }

  const admin = supabaseAdmin()

  // Un workspace_id equivocado insertaría filas huérfanas que después el
  // cron intentaría enviar contra un workspace sin conexión: falla tarde y
  // en silencio. Se valida acá, que es donde el error se puede devolver.
  if (!(await assertWorkspace(admin, workspaceId))) {
    return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 })
  }

  const country = String(body.country ?? 'AR').trim().toUpperCase() || 'AR'

  try {
    const result = await ingestRejectedPayments(admin, {
      workspaceId,
      defaultCountry: country,
      payments,
    })
    log.info('ingesta de pagos rechazados', { workspaceId, ...result })
    return NextResponse.json(result)
  } catch (err) {
    log.captureException(err, { workspaceId })
    return serverError(err)
  }
}

/**
 * GET /api/integrations/mercadopago/rejected?workspace_id=…&days=90
 *
 * Estado por fila para el write-back a la hoja. Devuelve `external_key` para
 * que la hoja empareje sin depender del orden.
 */
export async function GET(request: Request) {
  try {
    assertCronAuthAny(request, ['AUTOMATION_CRON_SECRET', 'CRON_SECRET'])
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const url = new URL(request.url)
  const workspaceId = parseWorkspaceId(url.searchParams.get('workspace_id'))
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }

  const daysRaw = Number(url.searchParams.get('days') ?? 90)
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 365) : 90
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('mp_rejected_payments')
    .select(
      'external_key, phone, contacted_at, recovered_at, recovered_amount, recovered_order_id, skip_reason, last_error',
    )
    .eq('workspace_id', workspaceId)
    .gte('rejected_at', since)
    .order('rejected_at', { ascending: false })

  if (error) return serverError(error)

  const rows = ((data ?? []) as {
    external_key: string
    phone: string | null
    contacted_at: string | null
    recovered_at: string | null
    recovered_amount: number | null
    recovered_order_id: string | null
    skip_reason: string | null
    last_error: string | null
  }[]).map((r) => ({
    external_key: r.external_key,
    estado: statusOf(r),
    contacted_at: r.contacted_at,
    recovered_at: r.recovered_at,
    recovered_amount: r.recovered_amount,
    recovered_order_id: r.recovered_order_id,
    detalle: r.skip_reason ?? r.last_error ?? null,
  }))

  const contactados = rows.filter((r) => r.contacted_at).length
  const recuperados = rows.filter((r) => r.recovered_at).length
  const montoRecuperado = rows.reduce((sum, r) => sum + (r.recovered_amount ?? 0), 0)

  return NextResponse.json({
    days,
    total: rows.length,
    contactados,
    recuperados,
    monto_recuperado: montoRecuperado,
    rows,
  })
}
