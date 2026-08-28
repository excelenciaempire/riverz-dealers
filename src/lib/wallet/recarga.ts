/**
 * Cargar saldo, y acreditarlo cuando Stripe confirma.
 *
 * Una recarga es un pago suelto, no una suscripción: el comercio elige cuánto y
 * paga una vez. Se arma con `price_data` en el momento y no con un precio
 * guardado en Stripe, porque el monto lo elige el comercio y crear un precio
 * por cada recarga llenaría el catálogo de basura.
 *
 * **El saldo lo acredita el webhook, nunca el regreso del checkout.** La URL de
 * éxito la puede escribir cualquiera: acreditar ahí sería regalar saldo a quien
 * sepa copiar una dirección. Y el `payment_intent` se guarda en el movimiento,
 * así que el mismo pago no acredita dos veces por más que el webhook llegue
 * repetido — que llega repetido.
 */
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/billing/stripe'
import { mover } from './saldo'

/** Lo mínimo y lo máximo que se puede cargar de una vez, en centavos. */
export const MINIMO_CENTAVOS = 1000
export const MAXIMO_CENTAVOS = 500_000

/** Los montos que ofrece el panel. El comercio igual puede escribir otro. */
export const SUGERIDOS_CENTAVOS = [2500, 5000, 10_000, 20_000]

function volverA(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://riverz.co'
  return `${base}${path}`
}

export function montoValido(centavos: number): boolean {
  return (
    Number.isFinite(centavos) &&
    Number.isInteger(centavos) &&
    centavos >= MINIMO_CENTAVOS &&
    centavos <= MAXIMO_CENTAVOS
  )
}

/**
 * Lleva a pagar una recarga.
 *
 * Reusa el cliente de Stripe de la cuenta si ya existe (lo escribió la
 * suscripción): dos clientes para el mismo comercio significan dos historiales
 * de pago y una discusión el día que alguien pida una factura.
 */
export async function urlDeRecarga(
  db: SupabaseClient,
  workspaceId: string,
  centavos: number,
  quien: { email: string | null; nombre: string | null },
): Promise<string> {
  if (!montoValido(centavos)) {
    throw new Error('El monto de la recarga está fuera de lo permitido.')
  }

  const { data: sus } = await db
    .from('workspace_subscriptions')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const customerId = (sus as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id

  const sesion = await stripe().checkout.sessions.create({
    mode: 'payment',
    ...(customerId
      ? { customer: customerId }
      : { customer_email: quien.email ?? undefined, customer_creation: 'always' }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: centavos,
          product_data: {
            name: 'Saldo Riverz',
            description:
              'Saldo para las respuestas de la IA, las llamadas y todo lo que consuma la cuenta.',
          },
        },
      },
    ],
    // El id de la cuenta viaja con el pago: el webhook llega sin sesión de
    // navegador y sin esto habría que adivinar de quién es la plata.
    metadata: {
      workspace_id: workspaceId,
      tipo: 'recarga_billetera',
      centavos: String(centavos),
    },
    payment_intent_data: {
      metadata: { workspace_id: workspaceId, tipo: 'recarga_billetera' },
    },
    success_url: volverA('/ajustes?tab=saldo&recarga=lista'),
    cancel_url: volverA('/ajustes?tab=saldo&recarga=cancelada'),
  })
  if (!sesion.url) throw new Error('Stripe no devolvió una URL de pago.')
  return sesion.url
}

/**
 * Acredita una recarga a partir del evento de Stripe.
 *
 * Devuelve un texto para el log del webhook. Ignora en silencio lo que no sea
 * una recarga: por el mismo endpoint pasan los eventos de suscripción.
 */
export async function acreditarDesdeEvento(
  db: SupabaseClient,
  evento: Stripe.Event,
): Promise<string | null> {
  if (evento.type !== 'checkout.session.completed') return null

  const sesion = evento.data.object as Stripe.Checkout.Session
  if (sesion.metadata?.tipo !== 'recarga_billetera') return null
  if (sesion.payment_status !== 'paid') {
    return `recarga sin pagar: ${sesion.id}`
  }

  const workspaceId = sesion.metadata?.workspace_id
  if (!workspaceId) return 'recarga sin workspace_id'

  const centavos = Number(sesion.amount_total ?? 0)
  if (!(centavos > 0)) return `recarga en cero: ${sesion.id}`

  const pago =
    typeof sesion.payment_intent === 'string'
      ? sesion.payment_intent
      : (sesion.payment_intent?.id ?? sesion.id)

  const r = await mover(db, workspaceId, {
    tipo: 'recarga',
    concepto: 'recarga',
    centavos,
    stripeId: pago,
    detalle: { sesion: sesion.id, moneda: sesion.currency ?? 'usd' },
  })
  return r.duplicado
    ? `recarga repetida, ignorada: ${pago}`
    : `${workspaceId}: +${centavos} → ${r.saldoCentavos}`
}
