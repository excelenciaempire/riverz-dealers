/**
 * Stripe, lo mínimo y nada más.
 *
 * Tres cosas: llevar a alguien a poner la tarjeta, llevarlo a cambiarla, y
 * escuchar lo que Stripe diga después. El estado de la suscripción **lo manda
 * Stripe**, siempre: acá no se decide que alguien está al día porque volvió de
 * un checkout con la URL de éxito — esa URL la puede escribir cualquiera. Se
 * espera el webhook.
 *
 * Los `price` NO se crean desde acá. Se pegan a mano en el plan desde /admin:
 * crear precios por API desde un panel es poder romper la facturación con un
 * click, y son tres campos que se cargan una vez.
 *
 * Sin las variables de entorno, todo esto queda dormido y la app funciona igual
 * — que es exactamente lo que pasa mientras a los primeros comercios se les
 * instala gratis.
 */
import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Suscripcion } from './plan'

let cliente: Stripe | null = null

export function stripeDisponible(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Falta STRIPE_SECRET_KEY.')
  cliente ??= new Stripe(key)
  return cliente
}

function volverA(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://riverz.co'
  return `${base}${path}`
}

/**
 * El cliente de Stripe de esta cuenta, creándolo la primera vez.
 *
 * Se guarda el id para que un segundo checkout no cree un cliente nuevo: dos
 * clientes para el mismo comercio significan dos suscripciones y dos cobros.
 */
async function clienteDe(
  db: SupabaseClient,
  workspaceId: string,
  s: Suscripcion,
  email: string | null,
  nombre: string | null,
): Promise<string> {
  if (s.stripeCustomerId) return s.stripeCustomerId
  const creado = await stripe().customers.create({
    email: email ?? undefined,
    name: nombre ?? undefined,
    metadata: { workspace_id: workspaceId },
  })
  await db
    .from('workspace_subscriptions')
    .update({ stripe_customer_id: creado.id, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
  return creado.id
}

/**
 * Lleva a poner la tarjeta.
 *
 * El excedente va como segundo ítem medido: la base se cobra siempre y las
 * conversaciones que se pasen del cupo se reportan al cierre del período. Si el
 * plan no tiene precio de excedente cargado, se suscribe sólo la base — un plan
 * a medio configurar tiene que poder cobrar lo que sí sabe cobrar.
 */
export async function urlDeCheckout(
  db: SupabaseClient,
  workspaceId: string,
  s: Suscripcion,
  quien: { email: string | null; nombre: string | null },
): Promise<string> {
  if (!s.plan?.stripePriceId) {
    throw new Error('Este plan todavía no tiene precio cargado en Stripe.')
  }
  const customer = await clienteDe(db, workspaceId, s, quien.email, quien.nombre)
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: s.plan.stripePriceId, quantity: 1 },
  ]
  if (s.plan.stripePriceExcedenteId) {
    items.push({ price: s.plan.stripePriceExcedenteId })
  }

  const sesion = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: items,
    // El id de la cuenta viaja con la suscripción: el webhook llega sin sesión
    // y sin esto habría que adivinar de quién es.
    subscription_data: { metadata: { workspace_id: workspaceId } },
    success_url: volverA('/ajustes?facturacion=lista'),
    cancel_url: volverA('/ajustes?facturacion=cancelada'),
  })
  if (!sesion.url) throw new Error('Stripe no devolvió una URL de pago.')
  return sesion.url
}

/** Lleva a cambiar la tarjeta, ver facturas o cancelar. Lo maneja Stripe. */
export async function urlDelPortal(s: Suscripcion): Promise<string> {
  if (!s.stripeCustomerId) throw new Error('Esta cuenta todavía no tiene cliente en Stripe.')
  const sesion = await stripe().billingPortal.sessions.create({
    customer: s.stripeCustomerId,
    return_url: volverA('/ajustes'),
  })
  return sesion.url
}

/**
 * Cancelar al final del período, o volver atrás.
 *
 * **Al final del período y no al instante**: el comercio ya pagó ese mes y
 * cortarle la operación el mismo día que cancela sería quedarse con plata suya.
 * Hasta que termine sigue andando igual, y puede arrepentirse — que es
 * exactamente lo que `reanudar` deshace.
 *
 * El estado que la app muestra lo sigue escribiendo el webhook: acá sólo se le
 * pide el cambio a Stripe.
 */
export async function cancelarSuscripcion(
  s: Suscripcion,
  cancelar: boolean,
): Promise<void> {
  if (!s.stripeSubscriptionId) {
    throw new Error('Esta cuenta no tiene una suscripción para cancelar.')
  }
  await stripe().subscriptions.update(s.stripeSubscriptionId, {
    cancel_at_period_end: cancelar,
  })
}

/** Cómo se traduce el estado de Stripe al nuestro. */
function estadoDe(s: Stripe.Subscription.Status): string {
  if (s === 'active' || s === 'trialing') return 'activa'
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete') return 'vencida'
  return 'cancelada'
}

/**
 * Lo que Stripe dice que pasó, guardado.
 *
 * Es la única fuente del estado. Volver del checkout no alcanza: esa URL la
 * escribe cualquiera, y una suscripción puede caerse tres semanas después sin
 * que nadie vuelva a pasar por la app.
 */
export async function aplicarEvento(
  db: SupabaseClient,
  evento: Stripe.Event,
): Promise<string> {
  const tipo = evento.type
  if (
    tipo !== 'customer.subscription.created' &&
    tipo !== 'customer.subscription.updated' &&
    tipo !== 'customer.subscription.deleted'
  ) {
    return `ignorado: ${tipo}`
  }

  const sub = evento.data.object as Stripe.Subscription
  const workspaceId = sub.metadata?.workspace_id
  if (!workspaceId) return 'sin workspace_id en la suscripción'

  const item = sub.items.data[0] as Stripe.SubscriptionItem | undefined
  const desde = item?.current_period_start
  const hasta = item?.current_period_end

  const estado =
    tipo === 'customer.subscription.deleted' ? 'cancelada' : estadoDe(sub.status)

  // El reloj de la gracia.
  //
  // Se marca la PRIMERA vez que el cobro falla y no se vuelve a tocar mientras
  // siga fallando: Stripe reintenta y manda `updated` varias veces, y si cada
  // uno reiniciara la marca la gracia no terminaría nunca. Volver a estar al
  // día la borra.
  let vencidaDesde: string | null | undefined
  if (estado === 'vencida') {
    const { data: actual } = await db
      .from('workspace_subscriptions')
      .select('vencida_desde')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const yaMarcada = (actual as { vencida_desde?: string | null } | null)?.vencida_desde
    vencidaDesde = yaMarcada ?? new Date().toISOString()
  } else {
    vencidaDesde = null
  }

  const { error } = await db
    .from('workspace_subscriptions')
    .update({
      estado,
      vencida_desde: vencidaDesde,
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      periodo_desde: desde ? new Date(desde * 1000).toISOString() : null,
      periodo_hasta: hasta ? new Date(hasta * 1000).toISOString() : null,
      cancelar_al_final: sub.cancel_at_period_end === true,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)
  return `${workspaceId}: ${sub.status}`
}
