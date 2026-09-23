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

/**
 * Cómo paga el consumo variable esta cuenta.
 *
 * `oficial` es el precio público actual: la mensualidad incluye el uso y la
 * billetera no interviene. `saldo` conserva el acuerdo anterior de las cuentas
 * que recargan y pagan cada consumo por separado.
 */
export type ModeloCobro = 'oficial' | 'saldo'

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
  /** Desde cuándo el cobro viene fallando. Es el reloj de la gracia. */
  vencidaDesde: string | null
  nota: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  cancelarAlFinal: boolean
  modeloCobro: ModeloCobro
  /**
   * Lo que se le cobra a ESTA cuenta, ya resuelto.
   *
   * El override de la cuenta gana sobre el plan. Se calcula acá y no en cada
   * pantalla: con la regla repetida en tres lugares, tarde o temprano una
   * muestra el precio de lista a alguien que tiene otro.
   */
  precioCentavos: number
  /** Precio pactado para el checkout, incluso durante la instalación en cortesía. */
  precioAcuerdoCentavos: number
  incluidas: number
  excedenteCentavos: number
  /** Si el precio de esta cuenta no es el del plan. */
  tratoPropio: boolean
}

/** Cuántos días dura la prueba de un comercio nuevo. */
export const DIAS_DE_PRUEBA = 5

/**
 * Cuántas horas sigue funcionando una cuenta después de un cobro fallido.
 *
 * No es generosidad: una tarjeta vencida, un banco que rechaza por sospecha o
 * un límite alcanzado se resuelven en un rato, y apagar la operación de un
 * comercio en el minuto uno lo deja sin atender a SUS clientes por un problema
 * administrativo que todavía no tuvo tiempo de arreglar.
 */
export const HORAS_DE_GRACIA = 48

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
  vencida_desde: string | null
  precio_centavos_override: number | null
  incluidas_override: number | null
  excedente_centavos_override: number | null
  nota: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  cancelar_al_final: boolean
  modelo_cobro: string
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
  const { data, error } = await db
    .from('billing_plans')
    .select(COLUMNAS_PLAN)
    .order('orden', { ascending: true })
  if (error) throw error
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
  const { data, error } = await db
    .from('workspace_subscriptions')
    .select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       vencida_desde, precio_centavos_override, incluidas_override, excedente_centavos_override,
       nota, stripe_customer_id, stripe_subscription_id, cancelar_al_final, modelo_cobro,
       billing_plans ( ${COLUMNAS_PLAN} )`,
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw error
  const f = data as unknown as FilaSuscripcion | null
  return f ? aSuscripcion(f) : null
}

export function aSuscripcion(f: FilaSuscripcion): Suscripcion {
  const plan = f.billing_plans ? aPlan(f.billing_plans) : null
  // La cortesía no paga, diga lo que diga el plan: es lo que significa.
  const cortesia = f.estado === 'cortesia'
  const precioAcuerdo = f.precio_centavos_override ?? plan?.precioCentavos ?? 0
  const precio = cortesia
    ? 0
    : precioAcuerdo
  return {
    workspaceId: f.workspace_id,
    plan,
    estado: f.estado as EstadoSuscripcion,
    pruebaHasta: f.prueba_hasta,
    periodoDesde: f.periodo_desde,
    periodoHasta: f.periodo_hasta,
    vencidaDesde: f.vencida_desde,
    nota: f.nota,
    stripeCustomerId: f.stripe_customer_id,
    stripeSubscriptionId: f.stripe_subscription_id,
    cancelarAlFinal: f.cancelar_al_final,
    modeloCobro: f.modelo_cobro === 'saldo' ? 'saldo' : 'oficial',
    precioCentavos: precio,
    precioAcuerdoCentavos: precioAcuerdo,
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
  const { error } = await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      plan_id: plan?.id ?? null,
      estado: 'prueba',
      prueba_hasta: hasta.toISOString(),
    },
    { onConflict: 'workspace_id', ignoreDuplicates: true },
  )
  if (error) throw error
  return (
    (await leerSuscripcion(db, workspaceId)) ?? {
      workspaceId,
      plan,
      estado: 'prueba',
      pruebaHasta: hasta.toISOString(),
      periodoDesde: null,
      periodoHasta: null,
      vencidaDesde: null,
      nota: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      cancelarAlFinal: false,
      modeloCobro: 'oficial',
      precioCentavos: plan?.precioCentavos ?? 0,
      precioAcuerdoCentavos: plan?.precioCentavos ?? 0,
      incluidas: plan?.incluidas ?? 0,
      excedenteCentavos: plan?.excedenteCentavos ?? 0,
      tratoPropio: false,
    }
  )
}

/** Sólo el acuerdo anterior usa y puede quedar bloqueado por la billetera. */
export function usaSaldo(s: Pick<Suscripcion, 'modeloCobro'> | null): boolean {
  return s?.modeloCobro === 'saldo'
}

export interface Acceso {
  /** Si la cuenta puede seguir usando Riverz. */
  puede: boolean
  estado: EstadoSuscripcion
  /** Días que le quedan de prueba. Sólo cuando está en prueba. */
  diasDePrueba: number | null
  /**
   * Horas que le quedan de gracia tras un cobro fallido. Sólo cuando está
   * vencida y todavía adentro de la ventana.
   */
  horasDeGracia: number | null
}

/**
 * ¿Esta cuenta puede seguir operando?
 *
 * La prueba vencida NO borra nada ni apaga los agentes: deja la cuenta en sólo
 * lectura. Apagar los agentes de alguien que se olvidó de poner la tarjeta
 * significa dejar de contestarle a SUS clientes, que no tienen nada que ver.
 */
export function acceso(s: Suscripcion | null): Acceso {
  if (!s) return { puede: true, estado: 'prueba', diasDePrueba: null, horasDeGracia: null }
  if (s.estado === 'activa' || s.estado === 'cortesia') {
    return { puede: true, estado: s.estado, diasDePrueba: null, horasDeGracia: null }
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
      horasDeGracia: null,
    }
  }
  // Vencida: 48 horas para arreglar la tarjeta y después se cierra.
  //
  // Sin `vencidaDesde` no se puede contar la gracia, y la respuesta correcta
  // ahí es darla igual: la marca la escribe el webhook, y una cuenta que quedó
  // vencida antes de que esta columna existiera no tiene por qué pagar ese
  // hueco con su operación.
  if (s.estado === 'vencida') {
    const desde = s.vencidaDesde ? Date.parse(s.vencidaDesde) : null
    if (desde === null || !Number.isFinite(desde)) {
      return { puede: true, estado: 'vencida', diasDePrueba: null, horasDeGracia: HORAS_DE_GRACIA }
    }
    const pasadas = (Date.now() - desde) / (60 * 60 * 1000)
    const quedan = HORAS_DE_GRACIA - pasadas
    return {
      puede: quedan > 0,
      estado: 'vencida',
      diasDePrueba: null,
      horasDeGracia: quedan > 0 ? Math.ceil(quedan) : 0,
    }
  }
  // Cancelada: sigue entrando hasta que termine el mes que ya pagó.
  //
  // Cancelar en Stripe "ahora" corta la suscripción al instante, y hasta acá
  // eso cortaba el acceso el mismo día — con el mes cobrado. Eso es quedarse
  // con plata ajena. Se paga hasta el 29, se usa hasta el 29.
  //
  // Sin fecha de período no se puede saber hasta cuándo, y ahí sí se corta: es
  // el caso de una suscripción que nunca llegó a cobrarse.
  if (s.estado === 'cancelada') {
    const hasta = s.periodoHasta ? Date.parse(s.periodoHasta) : null
    const vigente = hasta !== null && Number.isFinite(hasta) && hasta > Date.now()
    return {
      puede: vigente,
      estado: 'cancelada',
      diasDePrueba: null,
      horasDeGracia: null,
    }
  }

  return { puede: false, estado: s.estado, diasDePrueba: null, horasDeGracia: null }
}
