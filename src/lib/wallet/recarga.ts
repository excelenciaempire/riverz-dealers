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
import { COMISION_REAL, descontarComision } from './comision'
import { translate } from '@/lib/i18n/translate'
import { localeDeCuenta } from '@/lib/i18n/cuenta'

/**
 * Lo mínimo y lo máximo que se puede cargar de una vez, en centavos.
 *
 * Tres dólares. La plataforma no tiene por qué opinar sobre cuánto es "poco":
 * quien quiere probar con lo justo antes de confiarnos su operación está
 * haciendo exactamente lo que haría cualquiera. Un mínimo alto no protege a
 * nadie — sólo frena al que todavía no confía.
 */
export const MINIMO_CENTAVOS = 300
export const MAXIMO_CENTAVOS = 500_000

/**
 * Los montos que ofrece el panel. El comercio igual puede escribir otro.
 *
 * Arrancan en 10 y no en 25: el primero de la fila es el que dice "esto se
 * puede probar con poco", y a 5,5 centavos la respuesta, diez dólares son casi
 * doscientas conversaciones atendidas.
 */
export const SUGERIDOS_CENTAVOS = [1000, 2500, 5000, 10_000]

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
  // Un código, no una frase: quien lo muestra sabe en qué idioma está mirando
  // esa persona; esta función, no.
  if (!montoValido(centavos)) throw new Error('monto_fuera_de_rango')

  const { data: sus } = await db
    .from('workspace_subscriptions')
    .select('stripe_customer_id, modelo_cobro')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const subscription = sus as {
    stripe_customer_id?: string | null
    modelo_cobro?: string
  } | null
  if (subscription?.modelo_cobro !== 'saldo') throw new Error('consumo_incluido')
  const customerId = subscription.stripe_customer_id

  // El checkout es de Stripe pero lo que dice adentro es nuestro: el nombre del
  // producto y su descripción los escribimos acá, así que van en el idioma del
  // comercio. Y `locale` pone en ese idioma lo que escribe Stripe —los botones,
  // los campos de la tarjeta—, que si no sale en inglés siempre.
  const locale = await localeDeCuenta(db, workspaceId)

  const sesion = await stripe().checkout.sessions.create({
    mode: 'payment',
    locale,
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
            name: translate(locale, 'settings.walletProductName'),
            description: translate(locale, 'settings.walletProductDesc'),
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
      comision: COMISION_REAL,
    },
    payment_intent_data: {
      metadata: { workspace_id: workspaceId, tipo: 'recarga_billetera', comision: COMISION_REAL },
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
  // El cobro automático corre en un cron y acredita él mismo, en la misma
  // vuelta. Si el proceso se cae justo entre que Stripe cobra y que se escribe
  // el movimiento, la plata quedó cobrada y sin acreditar — y el comercio pagó
  // por nada. Esta rama es la red: el mismo pago llega también por webhook y se
  // acredita acá. No puede duplicar, porque el id del pago es único en el libro.
  if (evento.type === 'payment_intent.succeeded') {
    const pi = evento.data.object as Stripe.PaymentIntent
    if (pi.metadata?.tipo !== 'recarga_billetera') return null
    const workspaceId = pi.metadata?.workspace_id
    if (!workspaceId) return 'recarga sin workspace_id'
    const centavos = Number(pi.amount_received ?? pi.amount ?? 0)
    if (!(centavos > 0)) return `recarga en cero: ${pi.id}`
    if (pi.currency !== 'usd' || !Number.isSafeInteger(centavos)) throw new Error('wallet_invalid_topup')
    const r = await mover(db, workspaceId, {
      tipo: 'recarga',
      concepto: 'recarga',
      centavos,
      stripeId: pi.id,
      detalle: { moneda: pi.currency ?? 'usd', porWebhook: true },
    })
    // Gross credit is independent of asynchronous processor settlement.
    // A webhook retry records the cost without crediting the payment twice.
    await descontarComision(db, workspaceId, pi.id)
    return r.duplicado
      ? `recarga ya acreditada: ${pi.id}`
      : `${workspaceId}: +${centavos} → ${r.saldoCentavos} (rescatada del webhook)`
  }

  if (evento.type !== 'checkout.session.completed' && evento.type !== 'checkout.session.async_payment_succeeded') return null

  const sesion = evento.data.object as Stripe.Checkout.Session
  if (sesion.metadata?.tipo !== 'recarga_billetera') return null
  if (sesion.payment_status !== 'paid') {
    return `recarga sin pagar: ${sesion.id}`
  }

  const workspaceId = sesion.metadata?.workspace_id
  if (!workspaceId) return 'recarga sin workspace_id'

  const centavos = Number(sesion.amount_total ?? 0)
  if (!(centavos > 0)) return `recarga en cero: ${sesion.id}`
  if (sesion.currency !== 'usd' || !Number.isSafeInteger(centavos)) throw new Error('wallet_invalid_topup')

  const pago =
    typeof sesion.payment_intent === 'string'
      ? sesion.payment_intent
      : (sesion.payment_intent?.id ?? sesion.id)

  // El cliente de Stripe que quedó del pago, guardado.
  //
  // Sin esto, el comercio que recarga antes de suscribirse estrena un cliente
  // NUEVO en Stripe cada vez —`customer_creation: 'always'`— y termina con tres
  // clientes, tres historiales y una discusión el día que pida una factura. Se
  // escribe sólo si no había uno: el de la suscripción manda.
  const cliente =
    typeof sesion.customer === 'string' ? sesion.customer : (sesion.customer?.id ?? null)
  if (cliente) {
    const { data: sus } = await db
      .from('workspace_subscriptions')
      .select('stripe_customer_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!(sus as { stripe_customer_id?: string | null } | null)?.stripe_customer_id) {
      await db.from('workspace_subscriptions').upsert(
        {
          workspace_id: workspaceId,
          stripe_customer_id: cliente,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' },
      )
    }
  }

  const r = await mover(db, workspaceId, {
    tipo: 'recarga',
    concepto: 'recarga',
    centavos,
    stripeId: pago,
    detalle: { sesion: sesion.id, moneda: sesion.currency ?? 'usd' },
  })
  await descontarComision(db, workspaceId, pago)
  return r.duplicado
    ? `recarga repetida, ignorada: ${pago}`
    : `${workspaceId}: +${centavos} → ${r.saldoCentavos}`
}
