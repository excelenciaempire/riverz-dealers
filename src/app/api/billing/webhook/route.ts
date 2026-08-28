import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { aplicarEvento, stripe, stripeDisponible } from '@/lib/billing/stripe'
import { acreditarDesdeEvento } from '@/lib/wallet/recarga'
import { guardarTarjetaDesdeEvento } from '@/lib/wallet/auto'

/**
 * Lo que Stripe cuenta después.
 *
 * Es la ÚNICA fuente del estado de una suscripción. Volver del checkout no
 * alcanza —esa URL la escribe cualquiera— y una suscripción se puede caer tres
 * semanas más tarde sin que nadie vuelva a abrir la app.
 *
 * La firma se verifica sobre el cuerpo CRUDO. Con el cuerpo ya parseado la
 * firma nunca coincide, y aceptar sin verificar sería dejar que cualquiera
 * ponga a una cuenta en `activa` con un POST.
 *
 * Sin `STRIPE_WEBHOOK_SECRET` responde 200 y no hace nada: un webhook que
 * devuelve error hace que Stripe reintente durante días y termine desactivando
 * el endpoint.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeDisponible() || !secreto) {
    return NextResponse.json({ ok: true, nota: 'facturación sin configurar' })
  }

  const firma = request.headers.get('stripe-signature')
  if (!firma) return NextResponse.json({ error: 'sin firma' }, { status: 400 })

  const crudo = await request.text()
  let evento
  try {
    evento = stripe().webhooks.constructEvent(crudo, firma, secreto)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'firma inválida' },
      { status: 400 },
    )
  }

  try {
    const db = supabaseAdmin()
    // Por el mismo endpoint entran dos cosas distintas: el estado de la
    // suscripción y las recargas de saldo. Cada una ignora lo que no es suyo.
    const tarjeta = await guardarTarjetaDesdeEvento(db, evento)
    if (tarjeta) return NextResponse.json({ ok: true, que: tarjeta })
    const recarga = await acreditarDesdeEvento(db, evento)
    if (recarga) return NextResponse.json({ ok: true, que: recarga })
    const que = await aplicarEvento(db, evento)
    return NextResponse.json({ ok: true, que })
  } catch (e) {
    // 500 para que Stripe reintente: el evento es válido y algo nuestro falló.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'no se pudo aplicar' },
      { status: 500 },
    )
  }
}
