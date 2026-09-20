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
import { stripe } from '@/lib/billing/stripe';
import { localeDeCuenta } from '@/lib/i18n/cuenta';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { COMISION_REAL, descontarComision } from './comision';
import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS } from './recarga';
import { mover } from './saldo';

/** Después de esto, se deja de intentar hasta que cambien la tarjeta. */
export const FALLOS_PARA_RENDIRSE = 3;

/** Lo mínimo que se puede poner de umbral. Cero sería recargar tarde siempre. */
export const UMBRAL_MINIMO_CENTAVOS = 100;

async function exigirCuentaConSaldo(
  db: SupabaseClient,
  workspaceId: string
): Promise<void> {
  const { data, error } = await db
    .from('workspace_subscriptions')
    .select('modelo_cobro')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  if ((data as { modelo_cobro?: string } | null)?.modelo_cobro !== 'saldo') {
    throw new Error('consumo_incluido');
  }
}

function volverA(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://riverz.co';
  return `${base}${path}`;
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
  quien: { email: string | null; nombre: string | null }
): Promise<string> {
  const { data } = await db
    .from('workspace_subscriptions')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const existente = (data as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id;
  if (existente) return existente;

  const creado = await stripe().customers.create({
    email: quien.email ?? undefined,
    name: quien.nombre ?? undefined,
    metadata: { workspace_id: workspaceId },
  });
  await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      stripe_customer_id: creado.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' }
  );
  return creado.id;
}

/** Lleva a guardar una tarjeta. No cobra nada: sólo autoriza cobros futuros. */
export async function urlDeTarjeta(
  db: SupabaseClient,
  workspaceId: string,
  quien: { email: string | null; nombre: string | null }
): Promise<string> {
  await exigirCuentaConSaldo(db, workspaceId);
  const customer = await clienteDe(db, workspaceId, quien);
  const sesion = await stripe().checkout.sessions.create({
    mode: 'setup',
    customer,
    // El formulario de la tarjeta, en el idioma del comercio.
    locale: await localeDeCuenta(db, workspaceId),
    // Stripe la exige en `setup` aunque no se cobre nada: es la moneda en la
    // que va a poder cobrarse después. Sin esto responde
    // "Missing required param: currency" y no hay forma de guardar la tarjeta.
    currency: 'usd',
    metadata: { workspace_id: workspaceId, tipo: 'tarjeta_billetera' },
    success_url: volverA('/ajustes?tab=saldo&tarjeta=lista'),
    cancel_url: volverA('/ajustes?tab=saldo&tarjeta=cancelada'),
  });
  if (!sesion.url)
    throw new Error('Stripe no devolvió una URL para la tarjeta.');
  return sesion.url;
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
  evento: Stripe.Event
): Promise<string | null> {
  if (evento.type !== 'checkout.session.completed') return null;
  const sesion = evento.data.object as Stripe.Checkout.Session;
  if (sesion.metadata?.tipo !== 'tarjeta_billetera') return null;

  const workspaceId = sesion.metadata?.workspace_id;
  if (!workspaceId) return 'tarjeta sin workspace_id';

  const setupId =
    typeof sesion.setup_intent === 'string'
      ? sesion.setup_intent
      : (sesion.setup_intent?.id ?? null);
  if (!setupId) return 'tarjeta sin setup_intent';

  const setup = await stripe().setupIntents.retrieve(setupId);
  const metodo =
    typeof setup.payment_method === 'string'
      ? setup.payment_method
      : (setup.payment_method?.id ?? null);
  if (!metodo) return 'setup_intent sin método de pago';

  // La marca y los últimos cuatro, para que la pantalla pueda decir CUÁL
  // tarjeta quedó. "Hay una tarjeta" no le sirve a quien tiene tres.
  let marca: string | null = null;
  let ultimos4: string | null = null;
  try {
    const pm = await stripe().paymentMethods.retrieve(metodo);
    marca = pm.card?.brand ?? null;
    ultimos4 = pm.card?.last4 ?? null;
  } catch (e) {
    console.error('[wallet] no se pudo leer la tarjeta', e);
  }

  const { data: antes } = await db
    .from('wallet_accounts')
    .select('stripe_payment_method_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const anterior =
    (antes as { stripe_payment_method_id?: string | null } | null)
      ?.stripe_payment_method_id ?? null;

  await db.from('wallet_accounts').upsert(
    {
      workspace_id: workspaceId,
      stripe_payment_method_id: metodo,
      tarjeta_marca: marca,
      tarjeta_ultimos4: ultimos4,
      auto_fallos: 0,
      auto_ultimo_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' }
  );

  // Cambiar la tarjeta tiene que cambiarla EN TODO.
  //
  // Sin esto, la nueva sólo servía para las recargas automáticas: la
  // mensualidad seguía cobrándose a la vieja, que es justo la que la persona
  // acaba de dejar de usar — y el cobro rebotaba igual, sin que se entendiera
  // por qué. Se pone como predeterminada del cliente y se despega la anterior,
  // para que no quede una tarjeta muerta guardada en Stripe.
  const cliente =
    typeof sesion.customer === 'string'
      ? sesion.customer
      : (sesion.customer?.id ?? null);
  if (cliente) {
    try {
      await stripe().customers.update(cliente, {
        invoice_settings: { default_payment_method: metodo },
      });
    } catch (e) {
      console.error(
        '[wallet] no se pudo dejar la tarjeta como predeterminada',
        e
      );
    }
  }
  if (anterior && anterior !== metodo) {
    try {
      await stripe().paymentMethods.detach(anterior);
    } catch (e) {
      console.error('[wallet] no se pudo despegar la tarjeta anterior', e);
    }
  }

  return `${workspaceId}: tarjeta guardada${ultimos4 ? ` ····${ultimos4}` : ''}`;
}

/**
 * Quitar la tarjeta.
 *
 * Es lo mismo que apagar la recarga automática, y por eso apaga las dos cosas:
 * dejar la configuración prendida sin tarjeta sería prometer un cobro que no se
 * puede hacer, y el comercio se enteraría el día que se queda sin saldo.
 *
 * Se despega también de Stripe. Guardar una tarjeta que ya nadie va a usar es
 * quedarse con un dato de alguien sin motivo.
 */
export async function quitarTarjeta(
  db: SupabaseClient,
  workspaceId: string
): Promise<void> {
  const { data } = await db
    .from('wallet_accounts')
    .select('stripe_payment_method_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const metodo = (data as { stripe_payment_method_id?: string | null } | null)
    ?.stripe_payment_method_id;

  await db.from('wallet_accounts').upsert(
    {
      workspace_id: workspaceId,
      stripe_payment_method_id: null,
      tarjeta_marca: null,
      tarjeta_ultimos4: null,
      auto_recarga_centavos: null,
      auto_umbral_centavos: null,
      auto_fallos: 0,
      auto_ultimo_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' }
  );

  if (metodo) {
    try {
      await stripe().paymentMethods.detach(metodo);
    } catch (e) {
      // Que Stripe no la pueda despegar no puede dejar la tarjeta prendida acá:
      // lo que manda para cobrar es nuestra fila, y ya quedó vacía.
      console.error('[wallet] no se pudo despegar la tarjeta', e);
    }
  }
}

export interface ConfigAuto {
  recargaCentavos: number | null;
  umbralCentavos: number | null;
}

/** Valida y guarda cuánto recargar y con cuánto saldo dispararlo. */
export async function guardarConfigAuto(
  db: SupabaseClient,
  workspaceId: string,
  cfg: ConfigAuto
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
      { onConflict: 'workspace_id' }
    );
    return;
  }

  await exigirCuentaConSaldo(db, workspaceId);

  const recarga = Math.round(cfg.recargaCentavos);
  const umbral = Math.round(cfg.umbralCentavos);
  if (recarga < MINIMO_CENTAVOS || recarga > MAXIMO_CENTAVOS) {
    throw new Error('monto_fuera_de_rango');
  }
  if (umbral < UMBRAL_MINIMO_CENTAVOS || umbral >= recarga) {
    // El umbral tiene que ser menor que la recarga: si no, la primera recarga
    // deja el saldo por debajo del umbral otra vez y el cron cobraría en bucle.
    throw new Error('umbral_mayor_que_recarga');
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
    { onConflict: 'workspace_id' }
  );
}

interface FilaAuto {
  workspace_id: string;
  reservado_centavos?: number;
  saldo_centavos: number;
  auto_recarga_centavos: number | null;
  auto_umbral_centavos: number | null;
  stripe_payment_method_id: string | null;
  auto_fallos: number;
}

export interface ResultadoAuto {
  revisadas: number;
  cobradas: number;
  fallidas: number;
  detalle: string[];
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
  db: SupabaseClient
): Promise<ResultadoAuto> {
  const { data, error } = await db
    .from('wallet_accounts')
    .select(
      'workspace_id, saldo_centavos, reservado_centavos, auto_recarga_centavos, auto_umbral_centavos, stripe_payment_method_id, auto_fallos'
    )
    .not('auto_recarga_centavos', 'is', null)
    .lt('auto_fallos', FALLOS_PARA_RENDIRSE);
  if (error) throw new Error(`[wallet/auto] ${error.message}`);

  const filas = (data ?? []) as FilaAuto[];
  const detalle: string[] = [];
  let cobradas = 0;
  let fallidas = 0;

  for (const f of filas) {
    const umbral = f.auto_umbral_centavos ?? 0;
    const monto = f.auto_recarga_centavos ?? 0;
    if (Number(f.saldo_centavos) - Number(f.reservado_centavos ?? 0) > umbral)
      continue;
    if (!f.stripe_payment_method_id) {
      detalle.push(`${f.workspace_id}: sin tarjeta`);
      continue;
    }

    const { data: sus } = await db
      .from('workspace_subscriptions')
      .select('stripe_customer_id, modelo_cobro, estado')
      .eq('workspace_id', f.workspace_id)
      .maybeSingle();
    const subscription = sus as {
      stripe_customer_id?: string | null;
      modelo_cobro?: string;
      estado?: string;
    } | null;
    if (subscription?.modelo_cobro !== 'saldo' || subscription.estado === 'cortesia') {
      continue;
    }
    const customer = subscription.stripe_customer_id;
    if (!customer) {
      detalle.push(`${f.workspace_id}: sin cliente en Stripe`);
      continue;
    }

    const claim = await db.rpc('wallet_auto_reclamar', {
      p_workspace: f.workspace_id,
      p_customer: customer,
      p_method: f.stripe_payment_method_id,
      p_amount: monto,
      p_umbral: umbral,
    });
    if (claim.error) throw new Error(claim.error.message);
    const attempt = claim.data?.[0] as
      | {
          id: string;
          amount: number;
          customer_id: string;
          payment_method_id: string;
          payment_intent_id: string | null;
          created_at: string;
        }
      | undefined;
    if (!attempt) continue;
    if (
      !attempt.payment_intent_id &&
      Date.now() - Date.parse(attempt.created_at) > 23 * 3600000
    ) {
      detalle.push(
        `${f.workspace_id}: automatic payment requires reconciliation`
      );
      continue;
    }
    let paid = false;
    try {
      const pi = attempt.payment_intent_id
        ? await stripe().paymentIntents.retrieve(attempt.payment_intent_id)
        : await stripe().paymentIntents.create(
            {
              amount: Number(attempt.amount),
              currency: 'usd',
              customer: attempt.customer_id,
              payment_method: attempt.payment_method_id,
              off_session: true,
              confirm: true,
              metadata: {
                workspace_id: f.workspace_id,
                tipo: 'recarga_billetera',
                origen: 'automatica',
                comision: COMISION_REAL,
              },
            },
            { idempotencyKey: `wallet-auto:${attempt.id}` }
          );
      const saved = await db
        .from('wallet_auto_intentos')
        .update({ payment_intent_id: pi.id })
        .eq('id', attempt.id);
      if (saved.error) throw new Error(saved.error.message);
      if (pi.status !== 'succeeded') {
        throw new Error(`el pago quedó en ${pi.status}`);
      }
      paid = true;
      await descontarComision(db, f.workspace_id, pi.id);
      const r = await mover(db, f.workspace_id, {
        tipo: 'recarga',
        concepto: 'recarga',
        centavos: pi.amount_received,
        stripeId: pi.id,
        detalle: { automatica: true },
      });
      await db
        .from('wallet_accounts')
        .update({
          auto_fallos: 0,
          auto_ultimo_error: null,
          auto_ultimo_intento: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', f.workspace_id);
      await db
        .from('wallet_auto_intentos')
        .update({ estado: 'completada' })
        .eq('id', attempt.id);
      cobradas += 1;
      detalle.push(`${f.workspace_id}: +${monto} → ${r.saldoCentavos}`);
    } catch (e) {
      const knownFailure =
        !paid &&
        e &&
        typeof e === 'object' &&
        'type' in e &&
        ['StripeCardError', 'StripeInvalidRequestError'].includes(
          String(e.type)
        );
      if (!knownFailure) {
        detalle.push(
          `${f.workspace_id}: payment pending reconciliation (${attempt.id})`
        );
        console.error('[wallet/auto] pending attempt', attempt.id, e);
        continue;
      }
      await db
        .from('wallet_auto_intentos')
        .update({ estado: 'fallida' })
        .eq('id', attempt.id);
      const motivo =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'no se pudo cobrar';
      await db
        .from('wallet_accounts')
        .update({
          auto_fallos: (f.auto_fallos ?? 0) + 1,
          auto_ultimo_error: motivo.slice(0, 300),
          auto_ultimo_intento: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', f.workspace_id);
      fallidas += 1;
      detalle.push(`${f.workspace_id}: falló — ${motivo}`);
    }
  }

  return { revisadas: filas.length, cobradas, fallidas, detalle };
}
