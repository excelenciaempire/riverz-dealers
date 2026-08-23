/**
 * Qué hizo el Operador, y cuánto costó.
 *
 * Las dos preguntas viven juntas porque se contestan mirando lo mismo. «Qué
 * hizo» sale de `operator_actions`, que ya guardaba todo —la vista previa que
 * se leyó antes de aprobar, quién aprobó y cuándo— y sólo se leía desde adentro
 * de una conversación: para saber qué pasó la semana pasada había que abrir los
 * hilos uno por uno y acordarse de cuál era.
 *
 * «Cuánto costó» sale de `operator_agent_usage` (migración 174), que se escribe
 * desde entonces y **no lo lee nadie**. La tabla existe para contestar la
 * pregunta que decide el precio del producto: si el gasto se va en el
 * orquestador repartiendo o en los especialistas construyendo. Ese número no
 * puede vivir sólo en la base.
 *
 * El costo es una ESTIMACIÓN con las tarifas de lista, la misma que usa
 * `/admin/uso`: sirve para ver la tendencia y comparar, no para facturar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { costForModel } from '@/lib/admin/cost'
import { findCapability } from '@/lib/capabilities/registry'

export interface AccionHecha {
  id: string
  threadId: string | null
  /** El dominio, para agrupar: `automatizaciones`, `plantillas`… */
  dominio: string
  capabilityKey: string
  estado: 'propuesto' | 'ejecutado' | 'rechazado' | 'fallido' | 'deshecho'
  riesgo: 'lectura' | 'reversible' | 'irreversible'
  /** Lo que se leyó antes de decidir. */
  que: string | null
  cuando: string
  decididoEn: string | null
  /** El id de la entidad que quedó, cuando la dejó. */
  entidadId: string | null
  /**
   * Si esta acción se puede volver atrás.
   *
   * Lo decide la capacidad y no la pantalla: las que no se deshacen —un mensaje
   * enviado, una plantilla en Meta— simplemente no declaran cómo, y ofrecer el
   * botón igual sería mentir.
   */
  sePuedeDeshacer: boolean
}

export interface GastoDeAgente {
  agente: string
  llamadas: number
  entrada: number
  salida: number
  cache: number
  usd: number
}

export interface Actividad {
  acciones: AccionHecha[]
  gasto: GastoDeAgente[]
  totales: {
    hechas: number
    esperando: number
    descartadas: number
    fallidas: number
    usd: number
    /**
     * Cuánto de la entrada se leyó del caché.
     *
     * El prompt del sistema se cachea con un prefijo estable y sin este número
     * el acierto es una suposición. Un porcentaje bajo con muchos turnos quiere
     * decir que algo lo está rompiendo.
     */
    cachePct: number
  }
}

interface FilaAccion {
  id: string
  thread_id: string | null
  capability_key: string
  status: string
  risk: string
  preview: string | null
  result: { id?: string } | null
  created_at: string
  executed_at: string | null
}

interface FilaGasto {
  agente: string
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  llamadas: number
}

const TOPE_ACCIONES = 200

export async function leerActividad(
  db: SupabaseClient,
  workspaceId: string,
  desde: Date,
): Promise<Actividad> {
  const [accionesRes, gastoRes] = await Promise.all([
    db
      .from('operator_actions')
      .select('id, thread_id, capability_key, status, risk, preview, result, created_at, executed_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', desde.toISOString())
      .order('created_at', { ascending: false })
      .limit(TOPE_ACCIONES),
    db
      .from('operator_agent_usage')
      .select('agente, model, prompt_tokens, completion_tokens, cache_read_tokens, llamadas')
      .eq('workspace_id', workspaceId)
      .gte('created_at', desde.toISOString()),
  ])

  const acciones = ((accionesRes.data ?? []) as FilaAccion[]).map((a) => ({
    id: a.id,
    threadId: a.thread_id,
    dominio: a.capability_key.split('.')[0],
    capabilityKey: a.capability_key,
    estado: a.status as AccionHecha['estado'],
    riesgo: a.risk as AccionHecha['riesgo'],
    que: a.preview,
    cuando: a.created_at,
    decididoEn: a.executed_at,
    entidadId: typeof a.result?.id === 'string' ? a.result.id : null,
    sePuedeDeshacer:
      a.status === 'ejecutado' && Boolean(findCapability(a.capability_key)?.deshacer),
  }))

  // El desglose se agrupa acá y no en SQL: son decenas de filas por comercio y
  // la tarifa depende del modelo, que en SQL habría que duplicar.
  const porAgente = new Map<string, GastoDeAgente>()
  let entradaTotal = 0
  let cacheTotal = 0
  for (const g of (gastoRes.data ?? []) as FilaGasto[]) {
    const actual = porAgente.get(g.agente) ?? {
      agente: g.agente,
      llamadas: 0,
      entrada: 0,
      salida: 0,
      cache: 0,
      usd: 0,
    }
    actual.llamadas += g.llamadas ?? 0
    actual.entrada += g.prompt_tokens ?? 0
    actual.salida += g.completion_tokens ?? 0
    actual.cache += g.cache_read_tokens ?? 0
    actual.usd += costForModel(g.model, g.prompt_tokens ?? 0, g.completion_tokens ?? 0)
    porAgente.set(g.agente, actual)
    entradaTotal += g.prompt_tokens ?? 0
    cacheTotal += g.cache_read_tokens ?? 0
  }

  const gasto = [...porAgente.values()].sort((a, b) => b.usd - a.usd)

  return {
    acciones,
    gasto,
    totales: {
      hechas: acciones.filter((a) => a.estado === 'ejecutado').length,
      esperando: acciones.filter((a) => a.estado === 'propuesto').length,
      descartadas: acciones.filter((a) => a.estado === 'rechazado').length,
      fallidas: acciones.filter((a) => a.estado === 'fallido').length,
      usd: gasto.reduce((n, g) => n + g.usd, 0),
      cachePct:
        entradaTotal + cacheTotal > 0
          ? Math.round((cacheTotal / (entradaTotal + cacheTotal)) * 100)
          : 0,
    },
  }
}
