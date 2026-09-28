import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { handlePaymentNotification, isPaymentTopic } from '@/lib/mercadopago/notify'
import { getLogger } from '@/lib/log/logger'
import { validPaymentSignature } from '@/lib/mercadopago/webhook-signature'

const log = getLogger('mercadopago.webhook.app')

/**
 * URL propia para avisos de pago de Mercado Pago.
 *
 * La aplicación de Mercado Pago usa esta URL y su propia firma secreta.
 * Las conexiones antiguas de Mercado Libre y las URLs por comercio siguen
 * entrando por sus rutas respectivas. Sólo se procesan avisos auténticos.
 */
export async function POST(request: Request) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? ''
  if (!secret) return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })
  if (!validPaymentSignature(request, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }
  const body = (await request.json().catch(() => ({}))) as {
    type?: string
    topic?: string
    user_id?: string | number
  }
  const kind = body.type ?? body.topic
  if (kind && !isPaymentTopic(kind)) {
    return NextResponse.json({ ok: true, ignored: kind })
  }

  const url = new URL(request.url)
  const sellerId = String(body.user_id ?? url.searchParams.get('user_id') ?? '').trim()

  try {
    return NextResponse.json(await handlePaymentNotification(supabaseAdmin(), sellerId))
  } catch (err) {
    log.captureException(err, { sellerId })
    // El sync de respaldo lo levanta en la próxima media hora.
    return NextResponse.json({ ok: true, deferred: true })
  }
}

/** Mercado Pago valida la URL con un GET antes de guardarla. */
export function GET() {
  return NextResponse.json({ ok: true })
}
