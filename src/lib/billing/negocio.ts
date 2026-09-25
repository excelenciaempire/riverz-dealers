/**
 * El negocio, en números.
 *
 * Hasta acá no había forma de contestar «¿cuánto factura Riverz?» ni «¿cuánto
 * nos cuesta atender a estos comercios?». Las dos preguntas se contestan con lo
 * mismo: las suscripciones dicen lo que entra, `billing_usage_daily` dice lo
 * que sale.
 *
 * Un detalle que cambia la lectura del cuadro: las cuentas que todavía no
 * pagan cuentan como clientes con MRR 0, no se excluyen. En esta etapa son la
 * mayoría y sacarlas del cuadro haría parecer que la plataforma no tiene nadie
 * usándola — cuando el costo de atenderlas es real y es justo lo que hay que
 * mirar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aSuscripcion,
  type EstadoSuscripcion,
  type ModeloCobro,
  type Suscripcion,
} from './plan'

/**
 * Si la cuenta ya paga en Stripe (o Shopify), leído de su suscripción. Es lo
 * que ve el panel en lugar del estado interno.
 *
 *   sin_configurar  — todavía no tiene trato.
 *   sin_pagar       — tiene mensualidad y no completó el link.
 *   al_dia          — la suscripción está viva, incluido el mes sin cargo.
 *   fallido         — el último cobro falló.
 *   cancelado       — dio de baja la suscripción.
 *   sin_mensualidad — no paga mensualidad: sólo el consumo desde el saldo.
 */
export type EstadoDePago =
  | 'sin_configurar'
  | 'sin_pagar'
  | 'al_dia'
  | 'fallido'
  | 'cancelado'
  | 'sin_mensualidad'

export function estadoDePago(s: Suscripcion | undefined): EstadoDePago {
  if (!s) return 'sin_configurar'
  if (s.estado === 'vencida') return 'fallido'
  if (s.estado === 'cancelada') return 'cancelado'
  if (s.stripeSubscriptionId && s.estado === 'activa') return 'al_dia'
  if (s.precioAcuerdoCentavos <= 0) return 'sin_mensualidad'
  return 'sin_pagar'
}

export interface CuentaDelNegocio {
  workspaceId: string
  nombre: string
  correo: string | null
  estado: EstadoSuscripcion | 'sin_configurar'
  /** Si ya paga en Stripe o todavía no. */
  pago: EstadoDePago
  /** Cuándo vuelve a cobrarse, o cuándo termina si canceló al final del período. */
  periodoHasta: string | null
  cancelarAlFinal: boolean
  /** Tiene una suscripción de Stripe o Shopify, viva o no. */
  suscripcionExterna: boolean
  tieneSuscripcion: boolean
  /** Cobra con link de pago: no tiene una suscripción de Stripe o Shopify en curso. */
  admiteLinkPago: boolean
  plan: string | null
  planSlug: string | null
  /** Lo que paga por mes, en centavos. Sólo cuenta si está al día. */
  mrrCentavos: number
  /** La mensualidad pactada, aunque hoy esté en cortesía. */
  precioAcuerdoCentavos: number
  /** Contactos incluidos por mes, con el trato de esta cuenta. */
  incluidas: number
  conversaciones: number
  contactosAtendidos: number
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
  /** El consumo se le descuenta a costo, sin margen. */
  cobraACosto: boolean
  /** `oficial` incluye el uso; `saldo` conserva la billetera anterior. */
  modeloCobro: ModeloCobro
  /** Cargó su clave de Anthropic en algún agente: sin ella, una cuenta BYOK no responde. */
  tieneClavePropia: boolean
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
  /** Cuántas cuentas hay en cada estado de pago. */
  porPago: Record<EstadoDePago, number>
  /** Cuentas al día: el divisor del ingreso medio. */
  pagando: number
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
  owner_id: string | null
}

export async function leerNegocio(
  db: SupabaseClient,
  periodo: { desde: Date; hasta: Date },
): Promise<Negocio> {
  const dia = (d: Date) => d.toISOString().slice(0, 10)

  const [subsRes, wsRes, usoRes, billeterasRes, movimientosRes, clavesRes] = await Promise.all([
    db.from('workspace_subscriptions').select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       precio_centavos_override, incluidas_override, excedente_centavos_override,
       nota, stripe_customer_id, stripe_subscription_id, cancelar_al_final, modelo_cobro,
       billing_plans ( id, slug, nombre, activo, precio_centavos, moneda, incluidas,
                       excedente_centavos, stripe_price_id, stripe_price_excedente_id, orden )`,
    ),
    db.from('workspaces').select('id, name, owner_id').is('deleted_at', null),
    db
      .from('billing_usage_daily')
      .select('workspace_id, conversaciones, costo_usd')
      .gte('dia', dia(periodo.desde))
      .lt('dia', dia(periodo.hasta)),
    db.from('wallet_accounts').select('workspace_id, saldo_centavos, bloquear_sin_saldo, cobrar_a_costo'),
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
    // Sólo si existe; la clave nunca sale de la base.
    db.from('ai_agents').select('workspace_id').not('api_key_encrypted', 'is', null),
  ])
  for (const result of [subsRes, wsRes, usoRes, billeterasRes, movimientosRes, clavesRes]) {
    if (result.error) throw result.error
  }
  const conClavePropia = new Set(
    ((clavesRes.data ?? []) as { workspace_id: string }[]).map((a) => a.workspace_id),
  )

  const workspaces = (wsRes.data ?? []) as FilaWorkspace[]
  const dueños = [...new Set(workspaces.map((w) => w.owner_id).filter((id): id is string => Boolean(id)))]
  const perfilesRes = dueños.length
    ? await db.from('profiles').select('user_id, email').in('user_id', dueños)
    : { data: [], error: null }
  if (perfilesRes.error) throw perfilesRes.error
  const correos = new Map(((perfilesRes.data ?? []) as { user_id: string; email: string | null }[])
    .map((p) => [p.user_id, p.email]))
  const nombres = new Map(workspaces.map((w) => [w.id, {
    nombre: w.name ?? 'sin nombre',
    correo: w.owner_id ? correos.get(w.owner_id) ?? null : null,
  }]))

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
      cobrar_a_costo: boolean
    }[]).map((b) => [
      b.workspace_id,
      {
        saldo: Number(b.saldo_centavos ?? 0),
        bloquea: b.bloquear_sin_saldo === true,
        aCosto: b.cobrar_a_costo === true,
      },
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

  const suscripciones = new Map(subs.map((s) => [s.workspaceId, s]))
  const cuentas: CuentaDelNegocio[] = [...nombres.entries()]
    .map(([workspaceId, identidad]): CuentaDelNegocio => {
      const s = suscripciones.get(workspaceId)
      const u = uso.get(workspaceId) ?? { conversaciones: 0, costoUsd: 0 }
      const b = billeteras.get(workspaceId) ?? { saldo: 0, bloquea: false, aCosto: false }
      const l = libro.get(workspaceId) ?? { cargado: 0, gastado: 0, costo: 0 }
      const admiteLinkPago = !s || (s.billingProvider === 'stripe' &&
        (!s.stripeSubscriptionId || s.estado === 'cancelada'))
      const pago = estadoDePago(s)
      return {
        workspaceId,
        nombre: identidad.nombre,
        correo: identidad.correo,
        estado: s?.estado ?? 'sin_configurar',
        pago,
        periodoHasta: s?.periodoHasta ?? null,
        cancelarAlFinal: s?.cancelarAlFinal ?? false,
        suscripcionExterna: Boolean(s?.stripeSubscriptionId),
        tieneSuscripcion: Boolean(s),
        admiteLinkPago,
        plan: s?.plan?.nombre ?? null,
        planSlug: s?.plan?.slug ?? null,
        // Sólo lo que Stripe cobra es recurrente. Una cuenta sin pagar todavía
        // no paga y una cancelada dejó de pagar: contarlas infla el número que
        // se usa para tomar decisiones.
        mrrCentavos: pago === 'al_dia' ? s?.precioCentavos ?? 0 : 0,
        precioAcuerdoCentavos: s?.precioAcuerdoCentavos ?? 0,
        incluidas: s?.incluidas ?? 0,
        conversaciones: u.conversaciones,
        contactosAtendidos: 0,
        costoUsd: u.costoUsd,
        pruebaHasta: s?.pruebaHasta ?? null,
        vencidaDesde: s?.vencidaDesde ?? null,
        saldoCentavos: b.saldo,
        cargadoCentavos: l.cargado,
        gastadoCentavos: l.gastado,
        costoBilleteraCentavos: Math.round(l.costo),
        bloqueaSinSaldo: b.bloquea,
        cobraACosto: b.aCosto,
        modeloCobro: s?.modeloCobro ?? 'oficial',
        tieneClavePropia: conClavePropia.has(workspaceId),
      }
    })
    .sort((a, b) => Number(b.pago === 'sin_configurar') - Number(a.pago === 'sin_configurar') ||
      b.mrrCentavos - a.mrrCentavos || b.conversaciones - a.conversaciones)

  await Promise.all(cuentas.filter((c) => c.tieneSuscripcion && c.modeloCobro === 'oficial').map(async (c) => {
    const { data, error } = await db.rpc('billing_contactos_atendidos', {
      p_workspace: c.workspaceId,
      p_desde: periodo.desde.toISOString(),
      p_hasta: periodo.hasta.toISOString(),
    })
    if (error) throw error
    c.contactosAtendidos = Number(data ?? 0)
  }))

  const mrr = cuentas.reduce((n, c) => n + c.mrrCentavos, 0)
  const saldoTotal = cuentas.reduce((n, c) => n + c.saldoCentavos, 0)
  const cargado = cuentas.reduce((n, c) => n + c.cargadoCentavos, 0)
  const gastado = cuentas.reduce((n, c) => n + c.gastadoCentavos, 0)
  const costoBilletera = cuentas.reduce((n, c) => n + c.costoBilleteraCentavos, 0)
  const costoUsd = cuentas.reduce((n, c) => n + c.costoUsd, 0)
  const porPago: Record<EstadoDePago, number> = {
    sin_configurar: 0, sin_pagar: 0, al_dia: 0, fallido: 0, cancelado: 0, sin_mensualidad: 0,
  }
  for (const c of cuentas) porPago[c.pago] += 1
  const pagando = porPago.al_dia
  const ingresoUsd = mrr / 100

  return {
    mrrCentavos: mrr,
    arrCentavos: mrr * 12,
    costoUsd,
    margenPct: ingresoUsd > 0 ? Math.round(((ingresoUsd - costoUsd) / ingresoUsd) * 100) : null,
    porPago,
    pagando,
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
