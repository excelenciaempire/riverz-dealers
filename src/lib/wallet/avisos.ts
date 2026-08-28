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
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPlatformAlert } from '@/lib/admin/platform-whatsapp'
import { aQuienAvisar } from '@/lib/ai/aviso-escalada'
import { acceso, aSuscripcion } from '@/lib/billing/plan'
import { localeDeCuenta } from '@/lib/i18n/cuenta'
import { translate } from '@/lib/i18n/translate'

/** Saldo por debajo del cual se avisa, si la cuenta no fijó su propio umbral. */
const UMBRAL_POR_DEFECTO_CENTAVOS = 500

/** Nadie recibe el mismo aviso dos veces en menos de esto. */
const CADA_HORAS = 24

const HACE = (horas: number) =>
  new Date(Date.now() - horas * 60 * 60 * 1000).toISOString()

const usd = (centavos: number) => `US$${(centavos / 100).toFixed(2)}`

export interface Avisados {
  saldo: number
  plan: number
  detalle: string[]
}

interface FilaSaldo {
  workspace_id: string
  saldo_centavos: number
  auto_umbral_centavos: number | null
  auto_recarga_centavos: number | null
  stripe_payment_method_id: string | null
  avisado_en: string | null
  cobrar_a_costo: boolean | null
}

/**
 * Avisa a los que se están quedando sin saldo.
 *
 * No se le avisa al que tiene recarga automática **con tarjeta**: a ese no le
 * va a pasar nada, el cobro sale solo y un aviso de algo que no va a ocurrir es
 * ruido. Sí se le avisa si la tarjeta viene rebotando, porque ahí el automático
 * ya no lo salva.
 */
async function avisarSaldo(db: SupabaseClient): Promise<{ n: number; detalle: string[] }> {
  const detalle: string[] = []
  const { data, error } = await db
    .from('wallet_accounts')
    .select(
      'workspace_id, saldo_centavos, auto_umbral_centavos, auto_recarga_centavos, stripe_payment_method_id, avisado_en, cobrar_a_costo',
    )
  if (error) throw new Error(`[wallet/avisos] ${error.message}`)

  let n = 0
  for (const f of (data ?? []) as FilaSaldo[]) {
    const umbral = f.auto_umbral_centavos ?? UMBRAL_POR_DEFECTO_CENTAVOS
    const saldo = Number(f.saldo_centavos ?? 0)

    // Se repuso: se borra la marca para que el próximo aviso pueda salir.
    if (saldo > umbral) {
      if (f.avisado_en) {
        await db
          .from('wallet_accounts')
          .update({ avisado_en: null })
          .eq('workspace_id', f.workspace_id)
      }
      continue
    }

    const cubiertoPorElAutomatico =
      f.auto_recarga_centavos !== null && Boolean(f.stripe_payment_method_id)
    if (cubiertoPorElAutomatico) continue

    if (f.avisado_en && f.avisado_en > HACE(CADA_HORAS)) continue

    // La cuenta de cortesía no gasta saldo: avisarle que se queda sin nada
    // sería asustarla con algo que no la afecta.
    const { data: sus } = await db
      .from('workspace_subscriptions')
      .select('estado')
      .eq('workspace_id', f.workspace_id)
      .maybeSingle()
    if ((sus as { estado?: string } | null)?.estado === 'cortesia') continue

    const telefono = await aQuienAvisar(db, f.workspace_id)
    if (!telefono) {
      detalle.push(`${f.workspace_id}: sin número cargado`)
      continue
    }

    // En el idioma de la cuenta, no en el del servidor: el aviso lo lee una
    // persona, y una que eligió inglés en la app no tiene por qué recibir un
    // WhatsApp en español.
    const locale = await localeDeCuenta(db, f.workspace_id)
    const vacio = saldo <= 0
    const r = await sendPlatformAlert({
      to: telefono,
      title: translate(
        locale,
        vacio ? 'settings.avisoSinSaldoTitulo' : 'settings.avisoSaldoBajoTitulo',
      ),
      body: vacio
        ? translate(locale, 'settings.avisoSinSaldoCuerpo')
        : translate(locale, 'settings.avisoSaldoBajoCuerpo', { saldo: usd(saldo) }),
    })
    await db
      .from('wallet_accounts')
      .update({ avisado_en: new Date().toISOString() })
      .eq('workspace_id', f.workspace_id)
    if (r.ok) n += 1
    detalle.push(`${f.workspace_id}: saldo ${usd(saldo)} → ${r.ok ? 'avisado' : r.error}`)
  }
  return { n, detalle }
}

/**
 * Avisa al que tiene el cobro de la mensualidad caído.
 *
 * Sólo cuando el cobro **falló**: avisar "se te renueva en tres días" a alguien
 * que está al día y con tarjeta puesta es recordarle que paga, y no hay nada
 * que pueda hacer con esa información salvo arrepentirse.
 */
async function avisarPlan(db: SupabaseClient): Promise<{ n: number; detalle: string[] }> {
  const detalle: string[] = []
  const { data, error } = await db
    .from('workspace_subscriptions')
    .select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       vencida_desde, aviso_plan_en, precio_centavos_override, incluidas_override,
       excedente_centavos_override, nota, stripe_customer_id, stripe_subscription_id,
       cancelar_al_final,
       billing_plans ( id, slug, nombre, activo, precio_centavos, moneda, incluidas,
                       excedente_centavos, stripe_price_id, stripe_price_excedente_id, orden )`,
    )
    .eq('estado', 'vencida')
  if (error) throw new Error(`[wallet/avisos] ${error.message}`)

  let n = 0
  for (const cruda of (data ?? []) as unknown as Record<string, unknown>[]) {
    const avisadoEn = cruda.aviso_plan_en as string | null
    if (avisadoEn && avisadoEn > HACE(CADA_HORAS)) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = aSuscripcion(cruda as any)
    const a = acceso(s)
    const telefono = await aQuienAvisar(db, s.workspaceId)
    if (!telefono) {
      detalle.push(`${s.workspaceId}: sin número cargado`)
      continue
    }

    const locale = await localeDeCuenta(db, s.workspaceId)
    const r = await sendPlatformAlert({
      to: telefono,
      title: translate(
        locale,
        a.puede ? 'settings.avisoPlanFalloTitulo' : 'settings.avisoPlanPausadaTitulo',
      ),
      body: a.puede
        ? translate(locale, 'settings.avisoPlanFalloCuerpo', {
            horas: a.horasDeGracia ?? 48,
          })
        : translate(locale, 'settings.avisoPlanPausadaCuerpo'),
    })
    await db
      .from('workspace_subscriptions')
      .update({ aviso_plan_en: new Date().toISOString() })
      .eq('workspace_id', s.workspaceId)
    if (r.ok) n += 1
    detalle.push(`${s.workspaceId}: plan → ${r.ok ? 'avisado' : r.error}`)
  }
  return { n, detalle }
}

/** Los dos avisos, en una pasada. Ninguno puede tumbar al otro. */
export async function avisarLoQueHagaFalta(db: SupabaseClient): Promise<Avisados> {
  const [s, p] = await Promise.allSettled([avisarSaldo(db), avisarPlan(db)])
  const saldo = s.status === 'fulfilled' ? s.value : { n: 0, detalle: [`saldo: ${s.reason}`] }
  const plan = p.status === 'fulfilled' ? p.value : { n: 0, detalle: [`plan: ${p.reason}`] }
  return {
    saldo: saldo.n,
    plan: plan.n,
    detalle: [...saldo.detalle, ...plan.detalle],
  }
}
