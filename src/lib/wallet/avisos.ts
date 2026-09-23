/**
 * Avisarle al comercio antes de que se apague, no después.
 *
 * Los dos silencios que puede sufrir una cuenta son el saldo en cero y el cobro
 * de la mensualidad que no entró. Los dos se ven en pantalla, pero nadie mira
 * la pantalla a las once de la noche de un sábado: se enteran cuando un cliente
 * les dice que no le contestaron.
 *
 * Por eso el aviso sale por **WhatsApp, al número que la cuenta ya cargó** para
 * lo que la IA no decide sola. Es el único canal donde una persona ve el
 * mensaje en minutos.
 *
 * Dos reglas para que el aviso siga sirviendo:
 *
 * 1. **Uno por día como máximo, por tema.** Avisar cada cinco minutos —que es
 *    cada cuánto corre el cron— enseña a silenciar el número, y ese es el mismo
 *    número por el que después hay que avisar algo urgente.
 * 2. **Cuando se resuelve, se borra la marca.** El que recargó tiene que poder
 *    volver a recibir el aviso la próxima vez que baje. Sin eso, el segundo
 *    aviso llegaría un día tarde o no llegaría.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { destinosDeAviso, avisarATodos } from '@/lib/avisos/destinos';
import { acceso, aSuscripcion } from '@/lib/billing/plan';
import { localeDeCuenta } from '@/lib/i18n/cuenta';
import { translate } from '@/lib/i18n/translate';

/** Saldo por debajo del cual se avisa, si la cuenta no fijó su propio umbral. */
const UMBRAL_POR_DEFECTO_CENTAVOS = 500;

/** Nadie recibe el mismo aviso dos veces en menos de esto. */
const CADA_HORAS = 24;

/**
 * Cuánto se espera antes de avisar que el cobro falló.
 *
 * Stripe crea la suscripción en `incomplete` y recién la pasa a `active` cuando
 * el pago se confirma — con 3D Secure eso son minutos, y para nosotros
 * `incomplete` es "vencida". Sin esta espera, alguien que está tecleando el
 * código del banco recibía un WhatsApp diciéndole que no pudimos cobrarle. La
 * primera hora se la damos al banco.
 */
const ESPERA_ANTES_DE_AVISAR_HORAS = 1;

const HACE = (horas: number) =>
  new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();

const usd = (centavos: number) => `US$${(centavos / 100).toFixed(2)}`;

export interface Avisados {
  saldo: number;
  plan: number;
  detalle: string[];
}

interface FilaSaldo {
  workspace_id: string;
  saldo_centavos: number;
  auto_umbral_centavos: number | null;
  auto_recarga_centavos: number | null;
  stripe_payment_method_id: string | null;
  auto_fallos: number;
  avisado_en: string | null;
  cobrar_a_costo: boolean | null;
}

export function estadoDelAvisoDeSaldo(
  f: Pick<
    FilaSaldo,
    | 'saldo_centavos'
    | 'auto_umbral_centavos'
    | 'auto_recarga_centavos'
    | 'stripe_payment_method_id'
    | 'auto_fallos'
  >
): 'ninguno' | 'saldo_bajo' | 'sin_saldo' | 'auto_fallida' {
  const saldo = Number(f.saldo_centavos ?? 0);
  const umbral = f.auto_umbral_centavos ?? UMBRAL_POR_DEFECTO_CENTAVOS;
  if (saldo > umbral) return 'ninguno';

  const recargaAutomatica =
    f.auto_recarga_centavos !== null && Boolean(f.stripe_payment_method_id);
  if (recargaAutomatica) {
    return Number(f.auto_fallos ?? 0) > 0 ? 'auto_fallida' : 'ninguno';
  }
  return saldo <= 0 ? 'sin_saldo' : 'saldo_bajo';
}

/**
 * Avisa a los que se están quedando sin saldo.
 *
 * No se le avisa al que tiene recarga automática **con tarjeta**: a ese no le
 * va a pasar nada, el cobro sale solo y un aviso de algo que no va a ocurrir es
 * ruido. Sí se le avisa si la tarjeta viene rebotando, porque ahí el automático
 * ya no lo salva.
 */
async function avisarSaldo(
  db: SupabaseClient
): Promise<{ n: number; detalle: string[] }> {
  const detalle: string[] = [];
  const { data, error } = await db
    .from('wallet_accounts')
    .select(
      'workspace_id, saldo_centavos, auto_umbral_centavos, auto_recarga_centavos, stripe_payment_method_id, auto_fallos, avisado_en, cobrar_a_costo'
    );
  if (error) throw new Error(`[wallet/avisos] ${error.message}`);

  let n = 0;
  for (const f of (data ?? []) as FilaSaldo[]) {
    const umbral = f.auto_umbral_centavos ?? UMBRAL_POR_DEFECTO_CENTAVOS;
    const saldo = Number(f.saldo_centavos ?? 0);

    // Se repuso: se borra la marca para que el próximo aviso pueda salir.
    if (saldo > umbral) {
      if (f.avisado_en) {
        await db
          .from('wallet_accounts')
          .update({ avisado_en: null })
          .eq('workspace_id', f.workspace_id);
      }
      continue;
    }

    // Con recarga automática no se avisa por acercarse al umbral: ese es el
    // comportamiento esperado y el cobro debería resolverlo sin molestar a
    // nadie. Sólo se avisa después de que el intento quedó registrado como
    // fallido y el saldo siguió bajo.
    const estado = estadoDelAvisoDeSaldo(f);
    if (estado === 'ninguno') continue;

    if (f.avisado_en && f.avisado_en > HACE(CADA_HORAS)) continue;

    // La cuenta de cortesía no gasta saldo: avisarle que se queda sin nada
    // sería asustarla con algo que no la afecta.
    const { data: sus } = await db
      .from('workspace_subscriptions')
      .select('estado, modelo_cobro')
      .eq('workspace_id', f.workspace_id)
      .maybeSingle();
    const subscription = sus as {
      estado?: string;
      modelo_cobro?: string;
    } | null;
    if (
      subscription?.estado === 'cortesia' ||
      subscription?.modelo_cobro !== 'saldo'
    )
      continue;

    const telefonos = await destinosDeAviso(db, f.workspace_id, 'plata');
    if (telefonos.length === 0) {
      detalle.push(`${f.workspace_id}: sin número cargado`);
      continue;
    }

    // En el idioma de la cuenta, no en el del servidor: el aviso lo lee una
    // persona, y una que eligió inglés en la app no tiene por qué recibir un
    // WhatsApp en español.
    const locale = await localeDeCuenta(db, f.workspace_id);
    const titulo = translate(
      locale,
      estado === 'auto_fallida'
        ? 'settings.avisoRecargaAutoFalloTitulo'
        : estado === 'sin_saldo'
          ? 'settings.avisoSinSaldoTitulo'
          : 'settings.avisoSaldoBajoTitulo',
      { saldo: usd(saldo) }
    );
    const cuerpo =
      estado === 'auto_fallida'
        ? translate(locale, 'settings.avisoRecargaAutoFalloCuerpo', {
            saldo: usd(saldo),
          })
        : estado === 'sin_saldo'
          ? translate(locale, 'settings.avisoSinSaldoCuerpo')
          : translate(locale, 'settings.avisoSaldoBajoCuerpo', {
              saldo: usd(saldo),
            });
    const r = await avisarATodos(telefonos, { title: titulo, body: cuerpo });
    await db
      .from('wallet_accounts')
      .update({ avisado_en: new Date().toISOString() })
      .eq('workspace_id', f.workspace_id);
    if (r.ok) n += 1;
    detalle.push(
      `${f.workspace_id}: saldo ${usd(saldo)} → ${r.ok ? 'avisado' : r.error}`
    );
  }
  return { n, detalle };
}

/**
 * Avisa al que tiene el cobro de la mensualidad caído.
 *
 * Sólo cuando el cobro **falló**: avisar "se te renueva en tres días" a alguien
 * que está al día y con tarjeta puesta es recordarle que paga, y no hay nada
 * que pueda hacer con esa información salvo arrepentirse.
 */
async function avisarPlan(
  db: SupabaseClient
): Promise<{ n: number; detalle: string[] }> {
  const detalle: string[] = [];
  const { data, error } = await db
    .from('workspace_subscriptions')
    .select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       vencida_desde, aviso_plan_en, precio_centavos_override, incluidas_override,
       excedente_centavos_override, nota, stripe_customer_id, stripe_subscription_id,
       cancelar_al_final, modelo_cobro,
       billing_plans ( id, slug, nombre, activo, precio_centavos, moneda, incluidas,
                       excedente_centavos, stripe_price_id, stripe_price_excedente_id, orden )`
    )
    .eq('estado', 'vencida');
  if (error) throw new Error(`[wallet/avisos] ${error.message}`);

  let n = 0;
  for (const cruda of (data ?? []) as unknown as Record<string, unknown>[]) {
    const avisadoEn = cruda.aviso_plan_en as string | null;
    if (avisadoEn && avisadoEn > HACE(CADA_HORAS)) continue;

    // Recién vencida: puede ser un pago que se está confirmando ahora mismo.
    const desdeCuando = cruda.vencida_desde as string | null;
    if (desdeCuando && desdeCuando > HACE(ESPERA_ANTES_DE_AVISAR_HORAS))
      continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = aSuscripcion(cruda as any);
    const a = acceso(s);
    const telefonos = await destinosDeAviso(db, s.workspaceId, 'plata');
    if (telefonos.length === 0) {
      detalle.push(`${s.workspaceId}: sin número cargado`);
      continue;
    }

    const locale = await localeDeCuenta(db, s.workspaceId);
    const titulo = translate(
      locale,
      a.puede
        ? 'settings.avisoPlanFalloTitulo'
        : 'settings.avisoPlanPausadaTitulo'
    );
    const cuerpo = a.puede
      ? translate(locale, 'settings.avisoPlanFalloCuerpo', {
          horas: a.horasDeGracia ?? 48,
        })
      : translate(locale, 'settings.avisoPlanPausadaCuerpo');
    const r = await avisarATodos(telefonos, { title: titulo, body: cuerpo });
    await db
      .from('workspace_subscriptions')
      .update({ aviso_plan_en: new Date().toISOString() })
      .eq('workspace_id', s.workspaceId);
    if (r.ok) n += 1;
    detalle.push(`${s.workspaceId}: plan → ${r.ok ? 'avisado' : r.error}`);
  }
  return { n, detalle };
}

/** Los dos avisos, en una pasada. Ninguno puede tumbar al otro. */
export async function avisarLoQueHagaFalta(
  db: SupabaseClient
): Promise<Avisados> {
  const [s, p] = await Promise.allSettled([avisarSaldo(db), avisarPlan(db)]);
  const saldo =
    s.status === 'fulfilled'
      ? s.value
      : { n: 0, detalle: [`saldo: ${s.reason}`] };
  const plan =
    p.status === 'fulfilled'
      ? p.value
      : { n: 0, detalle: [`plan: ${p.reason}`] };
  return {
    saldo: saldo.n,
    plan: plan.n,
    detalle: [...saldo.detalle, ...plan.detalle],
  };
}
