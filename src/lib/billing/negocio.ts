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
  /** Desde cuándo el cobro viene fallando. Con esto se ve quién está en gracia. */
  vencidaDesde: string | null
  // ── Billetera ──
  /** Lo que le queda. Puede ser negativo dentro del descubierto. */
  saldoCentavos: number
  /** Lo que cargó en el período. Es plata que YA entró, aparte del MRR. */
  cargadoCentavos: number
  /** Lo que consumió en el período, a precio de venta. */
  gastadoCentavos: number
  /** Lo que ese consumo nos costó a nosotros. La otra mitad del margen. */
  costoBilleteraCentavos: number
  /** Si quedarse sin saldo le apaga la IA. */
  bloqueaSinSaldo: boolean
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
  // ── Billetera ──
  /** Todo el saldo sin usar que hay en la plataforma. Es plata cobrada y no
   *  prestada todavía: mirarla como ingreso del mes es engañarse. */
  saldoTotalCentavos: number
  /** Lo que se cargó en el período. Esto SÍ es ingreso del período. */
  cargadoCentavos: number
  /** Lo consumido en el período, a precio de venta. */
  gastadoCentavos: number
  /** Lo que ese consumo costó. */
  costoBilleteraCentavos: number
  /** Margen del consumo de la billetera. Null si todavía no consumió nadie. */
  margenBilleteraPct: number | null
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

  const [subsRes, wsRes, usoRes, billeterasRes, movimientosRes] = await Promise.all([
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
    db.from('wallet_accounts').select('workspace_id, saldo_centavos, bloquear_sin_saldo'),
    // El libro del período, crudo. Se suma acá y no con un `group by` en SQL
    // porque son los movimientos de un puñado de cuentas en un rango, y una
    // vista nueva por cada corte que quiera mirar el dueño no escala como
    // trabajo aunque escale como consulta.
    db
      .from('wallet_movimientos')
      .select('workspace_id, tipo, centavos, costo_centavos')
      .gte('creado_en', periodo.desde.toISOString())
      .lt('creado_en', periodo.hasta.toISOString())
      .limit(100_000),
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

  const billeteras = new Map(
    ((billeterasRes.data ?? []) as {
      workspace_id: string
      saldo_centavos: number
      bloquear_sin_saldo: boolean
    }[]).map((b) => [
      b.workspace_id,
      { saldo: Number(b.saldo_centavos ?? 0), bloquea: b.bloquear_sin_saldo === true },
    ]),
  )

  const libro = new Map<string, { cargado: number; gastado: number; costo: number }>()
  for (const m of (movimientosRes.data ?? []) as {
    workspace_id: string
    tipo: string
    centavos: number
    costo_centavos: number
  }[]) {
    const a = libro.get(m.workspace_id) ?? { cargado: 0, gastado: 0, costo: 0 }
    const c = Number(m.centavos ?? 0)
    // Sólo la recarga es ingreso. El bono es saldo regalado y contarlo como
    // plata que entró sería facturarse a uno mismo.
    if (m.tipo === 'recarga') a.cargado += c
    if (c < 0) {
      a.gastado += -c
      a.costo += Number(m.costo_centavos ?? 0)
    }
    libro.set(m.workspace_id, a)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs: Suscripcion[] = ((subsRes.data ?? []) as any[]).map(aSuscripcion)

  const cuentas: CuentaDelNegocio[] = subs
    // Una suscripción de un workspace borrado no es un cliente.
    .filter((s) => nombres.has(s.workspaceId))
    .map((s) => {
      const u = uso.get(s.workspaceId) ?? { conversaciones: 0, costoUsd: 0 }
      const b = billeteras.get(s.workspaceId) ?? { saldo: 0, bloquea: false }
      const l = libro.get(s.workspaceId) ?? { cargado: 0, gastado: 0, costo: 0 }
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
        vencidaDesde: s.vencidaDesde,
        saldoCentavos: b.saldo,
        cargadoCentavos: l.cargado,
        gastadoCentavos: l.gastado,
        costoBilleteraCentavos: Math.round(l.costo),
        bloqueaSinSaldo: b.bloquea,
      }
    })
    .sort((a, b) => b.mrrCentavos - a.mrrCentavos || b.conversaciones - a.conversaciones)

  const mrr = cuentas.reduce((n, c) => n + c.mrrCentavos, 0)
  const saldoTotal = cuentas.reduce((n, c) => n + c.saldoCentavos, 0)
  const cargado = cuentas.reduce((n, c) => n + c.cargadoCentavos, 0)
  const gastado = cuentas.reduce((n, c) => n + c.gastadoCentavos, 0)
  const costoBilletera = cuentas.reduce((n, c) => n + c.costoBilleteraCentavos, 0)
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
    saldoTotalCentavos: saldoTotal,
    cargadoCentavos: cargado,
    gastadoCentavos: gastado,
    costoBilleteraCentavos: costoBilletera,
    margenBilleteraPct:
      gastado > 0 ? Math.round(((gastado - costoBilletera) / gastado) * 100) : null,
    cuentas,
  }
}
