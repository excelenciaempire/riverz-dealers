/**
 * Recarga automática: la tarjeta guardada, y el cobro que se dispara solo.
 *
 * Sin esto, un comercio se queda sin saldo un domingo a la noche, la IA se
 * calla y se entera el lunes por un cliente que no recibió respuesta. Toda la
 * billetera existe para que ese domingo no pase.
 *
 * **La tarjeta no se guarda acá.** Se guarda en Stripe con una sesión de tipo
 * `setup` —que no cobra nada, sólo autoriza— y de vuelta llega un id. Guardar
 * un número de tarjeta convertiría esta base en un problema regulatorio que
 * hoy no es.
 *
 * **Se rinde a los tres fallos seguidos.** Una tarjeta vencida no se arregla
 * reintentando: se arregla cambiándola. Sin tope, la plataforma pasaría el mes
 * pegándole a un banco que ya dijo que no, y cada intento rechazado le cuesta
 * reputación a la cuenta de Stripe.
 */
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/billing/stripe'
import { mover } from './saldo'
import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS } from './recarga'

/** Después de esto, se deja de intentar hasta que cambien la tarjeta. */
export const FALLOS_PARA_RENDIRSE = 3

/** Lo mínimo que se puede poner de umbral. Cero sería recargar tarde siempre. */
export const UMBRAL_MINIMO_CENTAVOS = 100

function volverA(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://riverz.co'
  return `${base}${path}`
}

/**
 * El cliente de Stripe de esta cuenta.
 *
 * Se reusa el de la suscripción si existe: dos clientes para el mismo comercio
 * son dos historiales de pago y una discusión el día que pidan una factura.
 */
async function clienteDe(
  db: SupabaseClient,
  workspaceId: string,
  quien: { email: string | null; nombre: string | null },
): Promise<string> {
  const { data } = await db
    .from('workspace_subscriptions')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const existente = (data as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id
  if (existente) return existente

  const creado = await stripe().customers.create({
    email: quien.email ?? undefined,
    name: quien.nombre ?? undefined,
    metadata: { workspace_id: workspaceId },
  })
  await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      stripe_customer_id: creado.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
  return creado.id
}

/** Lleva a guardar una tarjeta. No cobra nada: sólo autoriza cobros futuros. */
export async function urlDeTarjeta(
  db: SupabaseClient,
  workspaceId: string,
  quien: { email: string | null; nombre: string | null },
): Promise<string> {
  const customer = await clienteDe(db, workspaceId, quien)
  const sesion = await stripe().checkout.sessions.create({
    mode: 'setup',
    customer,
    metadata: { workspace_id: workspaceId, tipo: 'tarjeta_billetera' },
    success_url: volverA('/ajustes?tab=saldo&tarjeta=lista'),
    cancel_url: volverA('/ajustes?tab=saldo&tarjeta=cancelada'),
  })
  if (!sesion.url) throw new Error('Stripe no devolvió una URL para la tarjeta.')
  return sesion.url
}

/**
 * Guarda la tarjeta que quedó autorizada.
 *
 * Llega por el webhook y no por la vuelta del checkout: esa URL la escribe
 * cualquiera, y además la autorización puede terminar de confirmarse después
 * de que la persona ya cerró la pestaña.
 *
 * Guardar la tarjeta **borra los fallos**: cambiar la tarjeta es exactamente lo
 * que hay que hacer cuando el cobro venía rebotando, y no reiniciar el contador
 * dejaría la recarga apagada para siempre después de tres rechazos.
 */
export async function guardarTarjetaDesdeEvento(
  db: SupabaseClient,
  evento: Stripe.Event,
): Promise<string | null> {
  if (evento.type !== 'checkout.session.completed') return null
  const sesion = evento.data.object as Stripe.Checkout.Session
  if (sesion.metadata?.tipo !== 'tarjeta_billetera') return null

  const workspaceId = sesion.metadata?.workspace_id
  if (!workspaceId) return 'tarjeta sin workspace_id'

  const setupId =
    typeof sesion.setup_intent === 'string'
      ? sesion.setup_intent
      : (sesion.setup_intent?.id ?? null)
  if (!setupId) return 'tarjeta sin setup_intent'

  const setup = await stripe().setupIntents.retrieve(setupId)
  const metodo =
    typeof setup.payment_method === 'string'
      ? setup.payment_method
      : (setup.payment_method?.id ?? null)
  if (!metodo) return 'setup_intent sin método de pago'

  await db.from('wallet_accounts').upsert(
    {
      workspace_id: workspaceId,
      stripe_payment_method_id: metodo,
      auto_fallos: 0,
      auto_ultimo_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
  return `${workspaceId}: tarjeta guardada`
}

export interface ConfigAuto {
  recargaCentavos: number | null
  umbralCentavos: number | null
}

/** Valida y guarda cuánto recargar y con cuánto saldo dispararlo. */
export async function guardarConfigAuto(
  db: SupabaseClient,
  workspaceId: string,
  cfg: ConfigAuto,
): Promise<void> {
  // Apagarla es mandar los dos en null. No hace falta un booleano aparte: el
  // estado "prendida sin monto" no significa nada y sería un caso más que
  // mantener en cada pantalla.
  if (cfg.recargaCentavos === null || cfg.umbralCentavos === null) {
    await db.from('wallet_accounts').upsert(
      {
        workspace_id: workspaceId,
        auto_recarga_centavos: null,
        auto_umbral_centavos: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    )
    return
  }

  const recarga = Math.round(cfg.recargaCentavos)
  const umbral = Math.round(cfg.umbralCentavos)
  if (recarga < MINIMO_CENTAVOS || recarga > MAXIMO_CENTAVOS) {
    throw new Error('El monto de la recarga está fuera de lo permitido.')
  }
  if (umbral < UMBRAL_MINIMO_CENTAVOS || umbral >= recarga) {
    // El umbral tiene que ser menor que la recarga: si no, la primera recarga
    // deja el saldo por debajo del umbral otra vez y el cron cobraría en bucle.
    throw new Error('El umbral tiene que ser menor que el monto de la recarga.')
  }

  await db.from('wallet_accounts').upsert(
    {
      workspace_id: workspaceId,
      auto_recarga_centavos: recarga,
      auto_umbral_centavos: umbral,
      // Cambiar la configuración es volver a intentar: si estaba rendida por
      // tres rechazos, esto le da otra oportunidad.
      auto_fallos: 0,
      auto_ultimo_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
}

interface FilaAuto {
  workspace_id: string
  saldo_centavos: number
  auto_recarga_centavos: number | null
  auto_umbral_centavos: number | null
  stripe_payment_method_id: string | null
  auto_fallos: number
}

export interface ResultadoAuto {
  revisadas: number
  cobradas: number
  fallidas: number
  detalle: string[]
}

/**
 * Recarga a todo el que haya bajado del umbral.
 *
 * El cobro es **fuera de sesión**: no hay nadie mirando la pantalla, así que si
 * el banco pide autenticación no hay quién la haga y el pago falla. Eso es
 * correcto y es justamente lo que cuenta como fallo: una tarjeta que exige al
 * titular en cada cobro no sirve para recargar sola, y hay que decirlo en vez
 * de reintentarla para siempre.
 *
 * Se acredita con `stripeId = pi.id`, así que si además llega el webhook del
 * mismo pago no acredita dos veces.
 */
export async function recargarLasQueHagaFalta(
  db: SupabaseClient,
): Promise<ResultadoAuto> {
  const { data, error } = await db
    .from('wallet_accounts')
    .select(
      'workspace_id, saldo_centavos, auto_recarga_centavos, auto_umbral_centavos, stripe_payment_method_id, auto_fallos',
    )
    .not('auto_recarga_centavos', 'is', null)
    .lt('auto_fallos', FALLOS_PARA_RENDIRSE)
  if (error) throw new Error(`[wallet/auto] ${error.message}`)

  const filas = (data ?? []) as FilaAuto[]
  const detalle: string[] = []
  let cobradas = 0
  let fallidas = 0

  for (const f of filas) {
    const umbral = f.auto_umbral_centavos ?? 0
    const monto = f.auto_recarga_centavos ?? 0
    if (Number(f.saldo_centavos) > umbral) continue
    if (!f.stripe_payment_method_id) {
      detalle.push(`${f.workspace_id}: sin tarjeta`)
      continue
    }

    const { data: sus } = await db
      .from('workspace_subscriptions')
      .select('stripe_customer_id')
      .eq('workspace_id', f.workspace_id)
      .maybeSingle()
    const customer = (sus as { stripe_customer_id?: string | null } | null)
      ?.stripe_customer_id
    if (!customer) {
      detalle.push(`${f.workspace_id}: sin cliente en Stripe`)
      continue
    }

    try {
      const pi = await stripe().paymentIntents.create({
        amount: monto,
        currency: 'usd',
        customer,
        payment_method: f.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          workspace_id: f.workspace_id,
          tipo: 'recarga_billetera',
          origen: 'automatica',
        },
      })
      if (pi.status !== 'succeeded') {
        throw new Error(`el pago quedó en ${pi.status}`)
      }
      const r = await mover(db, f.workspace_id, {
        tipo: 'recarga',
        concepto: 'recarga',
        centavos: monto,
        stripeId: pi.id,
        detalle: { automatica: true },
      })
      await db
        .from('wallet_accounts')
        .update({
          auto_fallos: 0,
          auto_ultimo_error: null,
          auto_ultimo_intento: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', f.workspace_id)
      cobradas += 1
      detalle.push(`${f.workspace_id}: +${monto} → ${r.saldoCentavos}`)
    } catch (e) {
      const motivo =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'no se pudo cobrar'
      await db
        .from('wallet_accounts')
        .update({
          auto_fallos: (f.auto_fallos ?? 0) + 1,
          auto_ultimo_error: motivo.slice(0, 300),
          auto_ultimo_intento: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', f.workspace_id)
      fallidas += 1
      detalle.push(`${f.workspace_id}: falló — ${motivo}`)
    }
  }

  return { revisadas: filas.length, cobradas, fallidas, detalle }
}
