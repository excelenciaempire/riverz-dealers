/**
 * Qué paga una cuenta, y en qué estado está.
 *
 * Riverz no tenía nada de esto: se podía operar un comercio de punta a punta y
 * no había dónde anotar que ese comercio paga. Acá está la respuesta a las dos
 * únicas preguntas que importan antes de dejar usar la app —¿está al día?, ¿le
 * queda prueba?— y a la que importa para cobrar: cuánto sale este mes.
 *
 * **El precio se edita, no se despliega.** Los planes son filas: cambiarlos es
 * un formulario en /admin. Y cada cuenta puede tener su propio trato, porque
 * en esta etapa a algunos comercios se les instala gratis y a otros se les hace
 * un precio distinto. Eso no se modela apagando la facturación —una cuenta
 * apagada desaparece del cuadro— sino con `cortesia` y los `*_override`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type EstadoSuscripcion =
  | 'prueba'
  | 'activa'
  | 'vencida'
  | 'cancelada'
  | 'cortesia'

export interface Plan {
  id: string
  slug: string
  nombre: string
  activo: boolean
  precioCentavos: number
  moneda: string
  incluidas: number
  excedenteCentavos: number
  stripePriceId: string | null
  stripePriceExcedenteId: string | null
  orden: number
}

export interface Suscripcion {
  workspaceId: string
  plan: Plan | null
  estado: EstadoSuscripcion
  pruebaHasta: string | null
  periodoDesde: string | null
  periodoHasta: string | null
  nota: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  cancelarAlFinal: boolean
  /**
   * Lo que se le cobra a ESTA cuenta, ya resuelto.
   *
   * El override de la cuenta gana sobre el plan. Se calcula acá y no en cada
   * pantalla: con la regla repetida en tres lugares, tarde o temprano una
   * muestra el precio de lista a alguien que tiene otro.
   */
  precioCentavos: number
  incluidas: number
  excedenteCentavos: number
  /** Si el precio de esta cuenta no es el del plan. */
  tratoPropio: boolean
}

/** Cuántos días dura la prueba de un comercio nuevo. */
export const DIAS_DE_PRUEBA = 5

const COLUMNAS_PLAN =
  'id, slug, nombre, activo, precio_centavos, moneda, incluidas, excedente_centavos, stripe_price_id, stripe_price_excedente_id, orden'

interface FilaPlan {
  id: string
  slug: string
  nombre: string
  activo: boolean
  precio_centavos: number
  moneda: string
  incluidas: number
  excedente_centavos: number
  stripe_price_id: string | null
  stripe_price_excedente_id: string | null
  orden: number
}

interface FilaSuscripcion {
  workspace_id: string
  plan_id: string | null
  estado: string
  prueba_hasta: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  precio_centavos_override: number | null
  incluidas_override: number | null
  excedente_centavos_override: number | null
  nota: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  cancelar_al_final: boolean
  billing_plans: FilaPlan | null
}

function aPlan(f: FilaPlan): Plan {
  return {
    id: f.id,
    slug: f.slug,
    nombre: f.nombre,
    activo: f.activo,
    precioCentavos: f.precio_centavos,
    moneda: f.moneda,
    incluidas: f.incluidas,
    excedenteCentavos: f.excedente_centavos,
    stripePriceId: f.stripe_price_id,
    stripePriceExcedenteId: f.stripe_price_excedente_id,
    orden: f.orden,
  }
}

export async function listarPlanes(db: SupabaseClient): Promise<Plan[]> {
  const { data } = await db
    .from('billing_plans')
    .select(COLUMNAS_PLAN)
    .order('orden', { ascending: true })
  return ((data ?? []) as unknown as FilaPlan[]).map(aPlan)
}

/** El plan más barato que esté activo: con el que arranca una cuenta nueva. */
export async function planPorDefecto(db: SupabaseClient): Promise<Plan | null> {
  const planes = (await listarPlanes(db)).filter((p) => p.activo)
  return planes[0] ?? null
}

export async function leerSuscripcion(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Suscripcion | null> {
  const { data } = await db
    .from('workspace_subscriptions')
    .select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       precio_centavos_override, incluidas_override, excedente_centavos_override,
       nota, stripe_customer_id, stripe_subscription_id, cancelar_al_final,
       billing_plans ( ${COLUMNAS_PLAN} )`,
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const f = data as unknown as FilaSuscripcion | null
  return f ? aSuscripcion(f) : null
}

export function aSuscripcion(f: FilaSuscripcion): Suscripcion {
  const plan = f.billing_plans ? aPlan(f.billing_plans) : null
  // La cortesía no paga, diga lo que diga el plan: es lo que significa.
  const cortesia = f.estado === 'cortesia'
  const precio = cortesia
    ? 0
    : (f.precio_centavos_override ?? plan?.precioCentavos ?? 0)
  return {
    workspaceId: f.workspace_id,
    plan,
    estado: f.estado as EstadoSuscripcion,
    pruebaHasta: f.prueba_hasta,
    periodoDesde: f.periodo_desde,
    periodoHasta: f.periodo_hasta,
    nota: f.nota,
    stripeCustomerId: f.stripe_customer_id,
    stripeSubscriptionId: f.stripe_subscription_id,
    cancelarAlFinal: f.cancelar_al_final,
    precioCentavos: precio,
    incluidas: f.incluidas_override ?? plan?.incluidas ?? 0,
    excedenteCentavos:
      f.excedente_centavos_override ?? plan?.excedenteCentavos ?? 0,
    tratoPropio:
      cortesia ||
      f.precio_centavos_override !== null ||
      f.incluidas_override !== null ||
      f.excedente_centavos_override !== null,
  }
}

/**
 * Arranca la suscripción de una cuenta nueva, en prueba.
 *
 * Idempotente: si ya tiene, no la toca. Se llama al crear el workspace y
 * también al leer el estado, porque las cuentas que existían antes de que esto
 * existiera no tienen fila y no por eso están vencidas.
 */
export async function asegurarSuscripcion(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Suscripcion> {
  const actual = await leerSuscripcion(db, workspaceId)
  if (actual) return actual

  const plan = await planPorDefecto(db)
  const hasta = new Date(Date.now() + DIAS_DE_PRUEBA * 24 * 60 * 60 * 1000)
  await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      plan_id: plan?.id ?? null,
      estado: 'prueba',
      prueba_hasta: hasta.toISOString(),
    },
    { onConflict: 'workspace_id' },
  )
  return (
    (await leerSuscripcion(db, workspaceId)) ?? {
      workspaceId,
      plan,
      estado: 'prueba',
      pruebaHasta: hasta.toISOString(),
      periodoDesde: null,
      periodoHasta: null,
      nota: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      cancelarAlFinal: false,
      precioCentavos: plan?.precioCentavos ?? 0,
      incluidas: plan?.incluidas ?? 0,
      excedenteCentavos: plan?.excedenteCentavos ?? 0,
      tratoPropio: false,
    }
  )
}

export interface Acceso {
  /** Si la cuenta puede seguir usando Riverz. */
  puede: boolean
  estado: EstadoSuscripcion
  /** Días que le quedan de prueba. Sólo cuando está en prueba. */
  diasDePrueba: number | null
}

/**
 * ¿Esta cuenta puede seguir operando?
 *
 * La prueba vencida NO borra nada ni apaga los agentes: deja la cuenta en sólo
 * lectura. Apagar los agentes de alguien que se olvidó de poner la tarjeta
 * significa dejar de contestarle a SUS clientes, que no tienen nada que ver.
 */
export function acceso(s: Suscripcion | null): Acceso {
  if (!s) return { puede: true, estado: 'prueba', diasDePrueba: null }
  if (s.estado === 'activa' || s.estado === 'cortesia') {
    return { puede: true, estado: s.estado, diasDePrueba: null }
  }
  if (s.estado === 'prueba') {
    const restante = s.pruebaHasta
      ? Math.ceil((Date.parse(s.pruebaHasta) - Date.now()) / (24 * 60 * 60 * 1000))
      : null
    const vigente = restante === null || restante > 0
    return {
      puede: vigente,
      estado: vigente ? 'prueba' : 'vencida',
      diasDePrueba: restante === null ? null : Math.max(0, restante),
    }
  }
  return { puede: false, estado: s.estado, diasDePrueba: null }
}
