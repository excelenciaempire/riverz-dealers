import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { countryOfPhone } from '@/lib/whatsapp/phone-utils'
import { freshAccessToken } from '@/lib/mercadopago/oauth'
import { syncWorkspaceRejectedPayments } from '@/lib/mercadopago/sync'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('mercadopago.webhook.app')

/**
 * Webhook único de la aplicación de Mercado Pago.
 *
 * Con OAuth la URL de avisos se configura UNA vez en la aplicación, no por
 * comercio: todos notifican acá y el aviso trae el `user_id` del vendedor,
 * que es con lo que se resuelve de quién es. Eso borra el segundo paso
 * manual que tenía la conexión vieja —pegar una URL propia en el panel de
 * Mercado Pago— y con él, la mitad de las formas de dejarla a medio hacer.
 *
 * La versión con el workspace en la URL sigue viva para las cuentas
 * conectadas pegando el token, que no pasan por la aplicación.
 *
 * Siempre responde 200: Mercado Pago reintenta ante cualquier otra cosa y
 * un reintento no arregla un pago que no nos interesa.
 */

const WINDOW_DAYS = 1

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    type?: string
    topic?: string
    user_id?: string | number
    data?: { id?: string }
  }
  const kind = (body.type ?? body.topic ?? '').toLowerCase()
  if (kind && kind !== 'payment') {
    return NextResponse.json({ ok: true, ignored: kind })
  }

  // El id del vendedor puede venir en el cuerpo o en la query, según el
  // formato de notificación que use la aplicación.
  const url = new URL(request.url)
  const sellerId = String(body.user_id ?? url.searchParams.get('user_id') ?? '').trim()
  if (!sellerId) {
    return NextResponse.json({ ok: true, unidentified: true })
  }

  const admin = supabaseAdmin()
  const { data } = await admin
    .from('workspace_integrations')
    .select('workspace_id')
    .eq('provider', 'mercadopago')
    .eq('external_account_id', sellerId)
    .eq('is_active', true)
    .maybeSingle()

  const workspaceId = (data as { workspace_id: string } | null)?.workspace_id
  if (!workspaceId) {
    // Desconectaron la cuenta pero Mercado Pago sigue avisando.
    return NextResponse.json({ ok: true, disconnected: true })
  }

  try {
    const token = await freshAccessToken(admin, workspaceId)
    if (!token) return NextResponse.json({ ok: true, no_token: true })

    const { data: conn } = await admin
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'whatsapp')
      .limit(1)
      .maybeSingle()
    const phone = (conn as { config?: { display_phone_number?: string } } | null)
      ?.config?.display_phone_number

    const res = await syncWorkspaceRejectedPayments(admin, {
      workspaceId,
      token,
      windowDays: WINDOW_DAYS,
      defaultCountry: countryOfPhone(phone) ?? 'AR',
    })
    return NextResponse.json({ ok: true, ...res.ingested })
  } catch (err) {
    log.captureException(err, { workspaceId })
    // El sync de respaldo lo levanta en la próxima media hora.
    return NextResponse.json({ ok: true, deferred: true })
  }
}

/** Mercado Pago valida la URL con un GET antes de guardarla. */
export function GET() {
  return NextResponse.json({ ok: true })
}
