import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { countryOfPhone } from '@/lib/whatsapp/phone-utils'
import { verifyWebhookToken } from '@/lib/mercadopago/webhook-url'
import { syncWorkspaceRejectedPayments } from '@/lib/mercadopago/sync'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('mercadopago.webhook')

/**
 * Notificaciones de Mercado Pago: un pago cambió de estado.
 *
 * Sin esto, un rechazo tardaba hasta media hora en entrar (el sync corre cada
 * 30 min). Con el webhook entra en segundos, que es lo que hace que la espera
 * del flujo se cuente desde el rechazo real y no desde cuando nos enteramos.
 *
 * La identidad va en la URL —workspace + firma derivada de ese workspace—
 * porque Mercado Pago no dice de qué cuenta es la notificación de forma
 * confiable, y como cada comercio conecta con SU access token tampoco hay un
 * secreto de firma compartido que verificar. Ver `webhook-url.ts`.
 *
 * Siempre responde 200. Mercado Pago reintenta ante cualquier otra cosa, y un
 * reintento no arregla un pago que no nos interesa: sólo genera ruido.
 */

/** Ventana que se re-sincroniza al recibir un aviso. */
const WINDOW_DAYS = 1

export async function POST(
  request: Request,
  ctx: { params: Promise<{ workspace: string; token: string }> },
) {
  const { workspace, token } = await ctx.params

  if (!verifyWebhookToken(workspace, token)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    type?: string
    topic?: string
    action?: string
  }
  const kind = (body.type ?? body.topic ?? '').toLowerCase()

  // Mercado Pago avisa de varias cosas (merchant_order, chargebacks…). Sólo
  // los pagos mueven esta aguja; el resto se acepta y se descarta.
  if (kind && kind !== 'payment') {
    return NextResponse.json({ ok: true, ignored: kind })
  }

  const admin = supabaseAdmin()
  const { data } = await admin
    .from('workspace_integrations')
    .select('api_key_encrypted')
    .eq('workspace_id', workspace)
    .eq('provider', 'mercadopago')
    .eq('is_active', true)
    .maybeSingle()

  const row = data as { api_key_encrypted: string } | null
  if (!row) {
    // Desconectaron Mercado Pago pero la URL sigue cargada en su panel.
    return NextResponse.json({ ok: true, disconnected: true })
  }

  try {
    const { data: conn } = await admin
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', workspace)
      .eq('channel', 'whatsapp')
      .limit(1)
      .maybeSingle()
    const phone = (conn as { config?: { display_phone_number?: string } } | null)
      ?.config?.display_phone_number

    // Se re-sincroniza la ventana corta en vez de traer sólo ese pago: es la
    // misma ruta que el cron, así que el agrupado por persona, el cruce del
    // teléfono y la detección de "compró igual" salen idénticos. La ingesta
    // es idempotente, de modo que repetir por varios avisos no duplica.
    const res = await syncWorkspaceRejectedPayments(admin, {
      workspaceId: workspace,
      token: decrypt(row.api_key_encrypted),
      windowDays: WINDOW_DAYS,
      defaultCountry: countryOfPhone(phone) ?? 'AR',
    })
    return NextResponse.json({ ok: true, ...res.ingested })
  } catch (err) {
    log.captureException(err, { workspaceId: workspace })
    // 200 igual: el sync de cada 30 minutos lo levanta después.
    return NextResponse.json({ ok: true, deferred: true })
  }
}

/** Mercado Pago valida la URL con un GET antes de guardarla. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ workspace: string; token: string }> },
) {
  const { workspace, token } = await ctx.params
  if (!verifyWebhookToken(workspace, token)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
