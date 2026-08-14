import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { handlePaymentNotification, isPaymentTopic } from '@/lib/mercadopago/notify'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('mercadopago.webhook.app')

/**
 * URL propia para avisos de pago de Mercado Pago.
 *
 * En la práctica los avisos llegan por el webhook de la aplicación de
 * Mercado Libre —una aplicación tiene una sola URL de notificaciones para
 * todos sus temas—, así que esto queda para una cuenta que registre una URL
 * dedicada. El trabajo es el mismo: ver `lib/mercadopago/notify.ts`.
 *
 * Siempre responde 200. Mercado Pago reintenta ante cualquier otra cosa y un
 * reintento no arregla un pago que no nos interesa.
 */
export async function POST(request: Request) {
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
