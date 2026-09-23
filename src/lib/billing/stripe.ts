/**
 * Stripe, lo mínimo y nada más.
 *
 * Tres cosas: llevar a alguien a poner la tarjeta, llevarlo a cambiarla, y
 * escuchar lo que Stripe diga después. El estado de la suscripción **lo manda
 * Stripe**, siempre: acá no se decide que alguien está al día porque volvió de
 * un checkout con la URL de éxito — esa URL la puede escribir cualquiera. Se
 * espera el webhook.
 *
 * Checkout usa el precio resuelto de la cuenta. Así un trato propio y los
 * nuevos niveles públicos no dependen de un Price ID pegado a mano.
 *
 * Sin las variables de entorno, todo esto queda dormido y la app funciona igual
 * — que es exactamente lo que pasa mientras a los primeros comercios se les
 * instala gratis.
 */
import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Suscripcion } from './plan'
import { localeDeCuenta } from '@/lib/i18n/cuenta'
import { translate } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/config'
import { eligibleForFirstMonthOffer, FIRST_MONTH_COUPON_ID, FIRST_MONTH_DISCOUNT_PERCENT } from './first-month-offer'

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

/** La suma visible en Checkout coincide con el acuerdo guardado en Riverz. */
export function lineItemsDeSuscripcion(
  s: Suscripcion,
  locale: Locale,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (!s.plan || s.precioAcuerdoCentavos <= 0) return []
  const nombrePlan = s.plan.slug === 'contactos-500'
    ? translate(locale, 'settings.billingPlan500')
    : s.plan.slug === 'contactos-2000'
      ? translate(locale, 'settings.billingPlan2000')
      : s.plan.slug === 'contactos-5000'
        ? translate(locale, 'settings.billingPlan5000')
        : s.plan.slug === 'contactos-10000'
          ? translate(locale, 'settings.billingPlan10000')
          : s.plan.nombre
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
    price_data: {
      currency: s.plan.moneda,
      unit_amount: s.precioAcuerdoCentavos,
      recurring: { interval: 'month' },
      product_data: { name: `Riverz · ${nombrePlan}` },
    },
    quantity: 1,
  }]
  if (s.modeloCobro === 'saldo' && s.plan.stripePriceExcedenteId) {
    items.push({ price: s.plan.stripePriceExcedenteId })
  }
  return items
}

/** Cupón de una sola factura; nunca se sustituye silenciosamente por precio completo. */
async function couponForFirstMonth(): Promise<string> {
  let coupon: Stripe.Coupon
  try {
    coupon = await stripe().coupons.retrieve(FIRST_MONTH_COUPON_ID)
  } catch (error) {
    if ((error as { code?: string }).code !== 'resource_missing') throw error
    try {
      coupon = await stripe().coupons.create({
        id: FIRST_MONTH_COUPON_ID,
        percent_off: FIRST_MONTH_DISCOUNT_PERCENT,
        duration: 'once',
        name: `Riverz · ${FIRST_MONTH_DISCOUNT_PERCENT}% primer mes / first month`,
      })
    } catch (createError) {
      // Dos checkouts simultáneos pueden crear el mismo cupón. El segundo
      // recupera el ya creado; cualquier otro error detiene el pago.
      coupon = await stripe().coupons.retrieve(FIRST_MONTH_COUPON_ID).catch(() => { throw createError })
    }
  }
  if (!coupon.valid || coupon.duration !== 'once' || coupon.percent_off !== FIRST_MONTH_DISCOUNT_PERCENT) {
    throw new Error('La promoción del primer mes no coincide con Stripe.')
  }
  return coupon.id
}

/**
 * Lleva a poner la tarjeta.
 *
 * El modelo oficial tiene una sola mensualidad. Sólo el acuerdo legado puede
 * llevar un segundo ítem medido si así estaba configurado en Stripe.
 */
export async function urlDeCheckout(
  db: SupabaseClient,
  workspaceId: string,
  s: Suscripcion,
  quien: { email: string | null; nombre: string | null },
  /**
   * Un cupón YA creado en Stripe, para el trato que se cerró por fuera.
   *
   * Sólo se **elige** uno existente: crearlo desde el panel sería poder
   * inventar un descuento con un click. Los cupones se arman en Stripe, que es
   * donde queda el rastro de quién lo hizo y por qué.
   */
  opciones?: { cupon?: string | null },
): Promise<string> {
  const locale = await localeDeCuenta(db, workspaceId)
  if (!s.plan || s.precioAcuerdoCentavos <= 0) {
    throw new Error(translate(locale, 'settings.billingMissingPrice'))
  }
  if (s.estado === 'cortesia' && !s.plan.activo) {
    throw new Error(translate(locale, 'settings.billingPlanInactive'))
  }
  if (s.stripeSubscriptionId && s.estado === 'activa') {
    throw new Error(translate(locale, 'settings.billingAlreadyActive'))
  }
  const customer = await clienteDe(db, workspaceId, s, quien.email, quien.nombre)
  const items = lineItemsDeSuscripcion(s, locale)
  const coupon = opciones?.cupon || (eligibleForFirstMonthOffer(s) ? await couponForFirstMonth() : null)

  const sesion = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    // Que el checkout hable el idioma del comercio y no el del navegador de
    // quien lo abrió: es la cuenta la que paga, no el navegador.
    locale,
    // El teléfono se pide en el checkout porque es el que de verdad mira la
    // persona que paga. El del perfil puede ser de otro —el que instaló la
    // cuenta, un socio— y el aviso de bienvenida terminaba en un teléfono que
    // no era el suyo, o en ninguno.
    phone_number_collection: { enabled: true },
    line_items: items,
    // El id de la cuenta viaja con la suscripción: el webhook llega sin sesión
    // y sin esto habría que adivinar de quién es.
    subscription_data: { metadata: { workspace_id: workspaceId } },
    ...(coupon ? { discounts: [{ coupon }] } : {}),
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

/** Cambia la mensualidad en Stripe para la próxima renovación, sin prorrateo.
 * Al pasar al modelo oficial también retira cualquier ítem medido legado. */
export async function sincronizarPrecioSuscripcion(
  s: Suscripcion,
  precioCentavos: number,
  moneda: string,
  modelo: 'oficial' | 'saldo',
): Promise<void> {
  if (!s.stripeSubscriptionId) return
  if (precioCentavos <= 0) throw new Error('La suscripción activa necesita un precio mensual positivo.')
  const sub = await stripe().subscriptions.retrieve(s.stripeSubscriptionId)
  const base = sub.items.data.find((i) => i.price.recurring?.usage_type !== 'metered')
  if (!base) throw new Error('La suscripción de Stripe no tiene una mensualidad editable.')
  const medidos = sub.items.data.filter((i) => i.price.recurring?.usage_type === 'metered')
  const cambiaPrecio = base.price.unit_amount !== precioCentavos || base.price.currency !== moneda
  if (!cambiaPrecio && (modelo !== 'oficial' || medidos.length === 0)) return

  let priceId = base.price.id
  if (cambiaPrecio) {
    const product = typeof base.price.product === 'string'
      ? base.price.product
      : base.price.product.id
    const nuevo = await stripe().prices.create({
      product,
      currency: moneda,
      unit_amount: precioCentavos,
      recurring: { interval: 'month' },
      metadata: { workspace_id: s.workspaceId },
    }, { idempotencyKey: `riverz-${s.workspaceId}-${precioCentavos}-${moneda}` })
    priceId = nuevo.id
  }

  await stripe().subscriptions.update(s.stripeSubscriptionId, {
    items: [
      { id: base.id, price: priceId, quantity: 1 },
      ...(modelo === 'oficial' ? medidos.map((i) => ({ id: i.id, deleted: true as const })) : []),
    ],
    proration_behavior: 'none',
  })
}

/**
 * El primer día pagando: asegurar la billetera y avisar.
 *
 * Se importa acá adentro y no arriba para no arrastrar el WhatsApp de la
 * plataforma —ni sus dependencias— a cada archivo que sólo quiere cobrar.
 */
async function darLaBienvenida(
  db: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  await db
    .from('wallet_accounts')
    .upsert({ workspace_id: workspaceId }, { onConflict: 'workspace_id' })

  const [{ destinosDeAviso, avisarATodos }, { enviarCorreo }] = await Promise.all([
    import('@/lib/avisos/destinos'),
    import('@/lib/admin/correo'),
  ])

  // Los mismos destinos que cualquier aviso de plata: los números que el
  // comercio cargó y el de quien puso la tarjeta. Antes la bienvenida elegía
  // UNO —el de Stripe si existía, y si no el del perfil— así que el equipo que
  // había cargado tres números no se enteraba de que la cuenta ya estaba
  // activa.
  const telefonos = await destinosDeAviso(db, workspaceId, 'plata')

  // El correo: el de quien pagó, y si no el del dueño de la cuenta.
  let correo: string | null = null
  const { data: sus } = await db
    .from('workspace_subscriptions')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const customerId = (sus as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id
  if (customerId) {
    try {
      const cliente = await stripe().customers.retrieve(customerId)
      if (!('deleted' in cliente && cliente.deleted)) correo = cliente.email ?? null
    } catch (e) {
      console.error('[billing] no se pudo leer el cliente de Stripe', e)
    }
  }
  if (!correo) {
    const { data: ws } = await db
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    const ownerId = (ws as { owner_id?: string | null } | null)?.owner_id ?? null
    if (ownerId) {
      const { data: p } = await db
        .from('profiles')
        .select('email')
        .eq('user_id', ownerId)
        .maybeSingle()
      correo = (p as { email?: string | null } | null)?.email ?? null
    }
  }

  const { data } = await db
    .from('wallet_accounts')
    .select('saldo_centavos')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const saldo = Number((data as { saldo_centavos?: number } | null)?.saldo_centavos ?? 0)

  const locale = await localeDeCuenta(db, workspaceId)
  const titulo = translate(locale, 'settings.avisoActivoTitulo')
  const cuerpo = translate(locale, 'settings.avisoActivoCuerpo', {
    saldo: `US$${(saldo / 100).toFixed(2)}`,
  })

  // Los dos canales, si los dos se pueden. Un aviso duplicado molesta; uno que
  // no sale, no se nota — y este es el que le confirma a alguien que su plata
  // llegó a algún lado.
  const via: string[] = []
  const porWhatsapp = await avisarATodos(telefonos, { title: titulo, body: cuerpo })
  if (porWhatsapp.ok) via.push(`whatsapp x${porWhatsapp.enviados}`)
  else if (telefonos.length > 0) {
    console.error('[billing] bienvenida por whatsapp falló:', porWhatsapp.error)
  }
  if (correo && (await enviarCorreo(correo, `Riverz · ${titulo}`, cuerpo))) {
    via.push('correo')
  }
  if (via.length === 0) {
    console.error('[billing] no se pudo dar la bienvenida', {
      workspaceId,
      telefonos: telefonos.length,
      correo: Boolean(correo),
    })
  }
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
  const { data: previa } = await db
    .from('workspace_subscriptions')
    .select('estado, vencida_desde')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const estadoPrevio = (previa as { estado?: string } | null)?.estado ?? null

  let vencidaDesde: string | null | undefined
  if (estado === 'vencida') {
    const yaMarcada = (previa as { vencida_desde?: string | null } | null)?.vencida_desde
    vencidaDesde = yaMarcada ?? new Date().toISOString()
  } else {
    vencidaDesde = null
  }

  // UPSERT y no update.
  //
  // Un `update` sobre una fila que no existe no falla: no hace nada y devuelve
  // ok. Una cuenta que paga sin haber pasado nunca por la pantalla de
  // facturación —que es exactamente quien entra por un link de pago— todavía no
  // tiene fila, así que su pago entraba en Stripe y en la app no cambiaba nada.
  // Sin error, sin rastro y sin acceso.
  const { error } = await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      estado,
      vencida_desde: vencidaDesde,
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      periodo_desde: desde ? new Date(desde * 1000).toISOString() : null,
      periodo_hasta: hasta ? new Date(hasta * 1000).toISOString() : null,
      cancelar_al_final: sub.cancel_at_period_end === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
  if (error) throw new Error(error.message)

  // Empezó a pagar. Se le avisa por WhatsApp y se le asegura la billetera.
  //
  // El aviso importa más de lo que parece: el día que una cuenta de cortesía
  // pasa a pagar es el día en que el saldo empieza a contar para ella, y
  // enterarse de eso por una IA que dejó de contestar sería la peor forma.
  // `bloquear_sin_saldo` NO se toca acá: nace apagado y se prende cuando la
  // cuenta ya cargó, no en el minuto en que pagó su primera mensualidad.
  if (estado === 'activa' && estadoPrevio !== 'activa') {
    void darLaBienvenida(db, workspaceId).catch((e) =>
      console.error('[billing] no se pudo avisar la activación', e),
    )
  }
  return `${workspaceId}: ${sub.status}`
}

/** Un descuento ya armado en Stripe, tal como se muestra en el panel. */
export interface CuponDeStripe {
  id: string
  nombre: string
  /** Cómo se lee el descuento: «-75%», «-US$300», y por cuánto tiempo. */
  detalle: string
}

/**
 * Los cupones vigentes.
 *
 * Se listan en vez de escribirse a mano porque un id tipeado mal no falla al
 * guardarlo: falla recién cuando el comercio abre el link y ve el precio
 * entero, que es el peor momento posible para enterarse.
 */
export async function cuponesVigentes(): Promise<CuponDeStripe[]> {
  const { data } = await stripe().coupons.list({ limit: 100 })
  return data
    .filter((c) => c.valid)
    .map((c) => {
      const cuanto =
        c.percent_off != null
          ? `-${c.percent_off}%`
          : c.amount_off != null
            ? `-${(c.amount_off / 100).toFixed(2)} ${(c.currency ?? '').toUpperCase()}`
            : ''
      const tiempo =
        c.duration === 'repeating' && c.duration_in_months
          ? ` · ${c.duration_in_months} meses`
          : c.duration === 'forever'
            ? ' · siempre'
            : c.duration === 'once'
              ? ' · un mes'
              : ''
      return { id: c.id, nombre: c.name ?? c.id, detalle: `${cuanto}${tiempo}` }
    })
}
