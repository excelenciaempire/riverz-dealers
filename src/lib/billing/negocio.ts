/**
 * El negocio, en números.
 *
 * Hasta acá no había forma de contestar «¿cuánto factura Riverz?» ni «¿cuánto
 * nos cuesta atender a estos comercios?». Las dos preguntas se contestan con lo
 * mismo: las suscripciones dicen lo que entra, `billing_usage_daily` dice lo
 * que sale.
 *
 * Un detalle que cambia la lectura del cuadro: las cuentas de **cortesía**
 * cuentan como clientes con MRR 0, no se excluyen. En esta etapa son la mayoría
 * y sacarlas del cuadro haría parecer que la plataforma no tiene nadie usándola
 * — cuando el costo de atenderlas es real y es justo lo que hay que mirar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { aSuscripcion, type EstadoSuscripcion, type Suscripcion } from './plan'

export interface CuentaDelNegocio {
  workspaceId: string
  nombre: string
  estado: EstadoSuscripcion
  plan: string | null
  /** Lo que paga por mes, en centavos. La cortesía es 0. */
  mrrCentavos: number
  tratoPropio: boolean
  nota: string | null
  conversaciones: number
  costoUsd: number
  pruebaHasta: string | null
}

export interface Negocio {
  /** Ingreso recurrente mensual, sumando lo que paga cada cuenta activa. */
  mrrCentavos: number
  /** El mismo número por año, que es como se habla de una plataforma. */
  arrCentavos: number
  /** Lo que costó la IA en el período. El otro lado del margen. */
  costoUsd: number
  /** Margen bruto sobre la IA, en porcentaje. Null si todavía no entra plata. */
  margenPct: number | null
  clientes: {
    pagando: number
    cortesia: number
    enPrueba: number
    vencidas: number
    canceladas: number
  }
  /** Ingreso medio por cuenta que paga. */
  arpuCentavos: number
  cuentas: CuentaDelNegocio[]
}

interface FilaWorkspace {
  id: string
  name: string | null
}

export async function leerNegocio(
  db: SupabaseClient,
  periodo: { desde: Date; hasta: Date },
): Promise<Negocio> {
  const dia = (d: Date) => d.toISOString().slice(0, 10)

  const [subsRes, wsRes, usoRes] = await Promise.all([
    db.from('workspace_subscriptions').select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       precio_centavos_override, incluidas_override, excedente_centavos_override,
       nota, stripe_customer_id, stripe_subscription_id, cancelar_al_final,
       billing_plans ( id, slug, nombre, activo, precio_centavos, moneda, incluidas,
                       excedente_centavos, stripe_price_id, stripe_price_excedente_id, orden )`,
    ),
    db.from('workspaces').select('id, name').is('deleted_at', null),
    db
      .from('billing_usage_daily')
      .select('workspace_id, conversaciones, costo_usd')
      .gte('dia', dia(periodo.desde))
      .lt('dia', dia(periodo.hasta)),
  ])

  const nombres = new Map(
    ((wsRes.data ?? []) as FilaWorkspace[]).map((w) => [w.id, w.name ?? 'sin nombre']),
  )

  const uso = new Map<string, { conversaciones: number; costoUsd: number }>()
  for (const u of (usoRes.data ?? []) as {
    workspace_id: string
    conversaciones: number
    costo_usd: number
  }[]) {
    const a = uso.get(u.workspace_id) ?? { conversaciones: 0, costoUsd: 0 }
    a.conversaciones += u.conversaciones ?? 0
    a.costoUsd += Number(u.costo_usd ?? 0)
    uso.set(u.workspace_id, a)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs: Suscripcion[] = ((subsRes.data ?? []) as any[]).map(aSuscripcion)

  const cuentas: CuentaDelNegocio[] = subs
    // Una suscripción de un workspace borrado no es un cliente.
    .filter((s) => nombres.has(s.workspaceId))
    .map((s) => {
      const u = uso.get(s.workspaceId) ?? { conversaciones: 0, costoUsd: 0 }
      return {
        workspaceId: s.workspaceId,
        nombre: nombres.get(s.workspaceId) ?? 'sin nombre',
        estado: s.estado,
        plan: s.plan?.nombre ?? null,
        // Sólo lo ACTIVO es recurrente. Una prueba todavía no paga y una
        // cancelada dejó de pagar: contarlas infla el número que se usa para
        // tomar decisiones.
        mrrCentavos: s.estado === 'activa' ? s.precioCentavos : 0,
        tratoPropio: s.tratoPropio,
        nota: s.nota,
        conversaciones: u.conversaciones,
        costoUsd: u.costoUsd,
        pruebaHasta: s.pruebaHasta,
      }
    })
    .sort((a, b) => b.mrrCentavos - a.mrrCentavos || b.conversaciones - a.conversaciones)

  const mrr = cuentas.reduce((n, c) => n + c.mrrCentavos, 0)
  const costoUsd = cuentas.reduce((n, c) => n + c.costoUsd, 0)
  const pagando = cuentas.filter((c) => c.estado === 'activa').length
  const ingresoUsd = mrr / 100

  return {
    mrrCentavos: mrr,
    arrCentavos: mrr * 12,
    costoUsd,
    margenPct: ingresoUsd > 0 ? Math.round(((ingresoUsd - costoUsd) / ingresoUsd) * 100) : null,
    clientes: {
      pagando,
      cortesia: cuentas.filter((c) => c.estado === 'cortesia').length,
      enPrueba: cuentas.filter((c) => c.estado === 'prueba').length,
      vencidas: cuentas.filter((c) => c.estado === 'vencida').length,
      canceladas: cuentas.filter((c) => c.estado === 'cancelada').length,
    },
    arpuCentavos: pagando > 0 ? Math.round(mrr / pagando) : 0,
    cuentas,
  }
}
