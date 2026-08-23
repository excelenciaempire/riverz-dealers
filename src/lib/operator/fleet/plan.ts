/**
 * El reparto: quién hace qué, en qué orden.
 *
 * Un plan es lo que se aprueba de una sola vez. Antes cada escritura pedía su
 * click, y con equipo eso se vuelve absurdo: pedir "armá recuperación de
 * carritos" y tener que aprobar tres tarjetas seguidas es peor experiencia que
 * la de antes, no mejor.
 *
 * Aprobar el plan aprueba EL REPARTO, y habilita construir lo que queda apagado
 * sin más clicks. Lo que le llega a una persona, sale a Meta o mueve dinero
 * sigue dejando su propia fila con su propio botón, dentro del plan aprobado y
 * fuera de él. Esa línea la decide `esInerte` y no se toca acá.
 *
 * Lo que corre después es lo GUARDADO, textual. Nunca se le vuelve a preguntar
 * al modelo qué había que hacer: si se le preguntara, podría repartir distinto
 * de lo que la persona aprobó, que es exactamente lo que la aprobación viene a
 * impedir. Misma regla que ejecutar los `args` guardados de una acción.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { olas as calcularOlas } from './olas'
import { esSubagentId, type SubagentId } from './types'

/** Cuántos pasos como mucho. Más que esto no es un plan, es un proyecto. */
const MAX_PASOS = 12
const MAX_ENCARGO = 600

export interface PasoValidado {
  i: number
  agente: SubagentId
  /** Qué va a pasar, en castellano. Es lo ÚNICO que se muestra al aprobar. */
  que: string
  /** La instrucción para el especialista, con los nombres exactos. No se muestra. */
  encargo: string
  dependeDe: number[]
}

export interface PlanValidado {
  porque: string
  pasos: PasoValidado[]
  /** Qué puede correr junto. Se calcula al validar, no al ejecutar. */
  olas: number[][]
}

export type Validacion =
  | { ok: true; plan: PlanValidado }
  | { ok: false; error: string }

/**
 * Revisa el reparto que escribió el modelo.
 *
 * Falla con un mensaje en castellano y no con una excepción: el modelo puede
 * corregir y volver a intentar en la misma vuelta, y "los pasos 0 y 1 se
 * esperan entre sí" es algo que se puede arreglar. Una excepción sería tirar el
 * turno por un error de escritura.
 */
/**
 * Le saca la comilla suelta al final (o al principio).
 *
 * El modelo cierra a veces una frase con una comilla que nunca abrió —se vio
 * en la primera corrida real: "…al armar el envío."— y esa comilla se imprime
 * tal cual. No es un error de nadie que se pueda arreglar pidiéndoselo mejor:
 * pasa cuando el texto viene de un campo que él imagina entrecomillado.
 */
function sinComillaSuelta(texto: string): string {
  let t = texto
  for (const c of ['"', "'", '«', '»', '“', '”']) {
    const n = t.split(c).length - 1
    if (n % 2 === 1) {
      if (t.endsWith(c)) t = t.slice(0, -1)
      else if (t.startsWith(c)) t = t.slice(1)
    }
  }
  return t.trim()
}

export function validarPlan(entrada: unknown): Validacion {
  const e = (entrada ?? {}) as { porque?: unknown; pasos?: unknown }
  if (!Array.isArray(e.pasos) || e.pasos.length === 0) {
    return { ok: false, error: 'El plan no tiene pasos.' }
  }
  if (e.pasos.length > MAX_PASOS) {
    return {
      ok: false,
      error: `Son ${e.pasos.length} pasos y el máximo es ${MAX_PASOS}. Junta lo que sea del mismo dominio en un solo encargo.`,
    }
  }

  const pasos: PasoValidado[] = []
  for (let i = 0; i < e.pasos.length; i++) {
    const p = e.pasos[i] as {
      subagente?: unknown
      que?: unknown
      encargo?: unknown
      depende_de?: unknown
    }
    if (!esSubagentId(p?.subagente)) {
      return { ok: false, error: `El paso ${i} le habla a "${String(p?.subagente)}", que no está en el equipo.` }
    }
    const encargo = typeof p?.encargo === 'string' ? sinComillaSuelta(p.encargo) : ''
    if (!encargo) return { ok: false, error: `El paso ${i} no dice qué hay que hacer.` }
    if (encargo.length > MAX_ENCARGO) {
      return { ok: false, error: `El encargo del paso ${i} es larguísimo. Dilo en menos.` }
    }

    const deps = Array.isArray(p?.depende_de) ? p.depende_de : []
    const dependeDe: number[] = []
    for (const d of deps) {
      const n = Number(d)
      if (!Number.isInteger(n) || n < 0 || n >= e.pasos.length) {
        return { ok: false, error: `El paso ${i} depende del ${String(d)}, que no existe.` }
      }
      if (n === i) return { ok: false, error: `El paso ${i} se depende de sí mismo.` }
      dependeDe.push(n)
    }
    // Sin `que` se cae al encargo: un plan sin su línea en castellano se lee
    // peor, pero no se pierde. Rechazarlo tiraría el trabajo entero por un
    // campo de presentación.
    const que = typeof p?.que === 'string' ? sinComillaSuelta(p.que).trim() : ''
    pasos.push({ i, agente: p.subagente, que: que || encargo, encargo, dependeDe })
  }

  const r = calcularOlas(pasos.map((p) => ({ i: p.i, dependeDe: p.dependeDe })))
  if (!r.ok) {
    return {
      ok: false,
      error: `Los pasos ${r.ciclo.join(' y ')} se esperan entre sí, así que ninguno puede empezar.`,
    }
  }

  const porque = typeof e.porque === 'string' ? sinComillaSuelta(e.porque) : ''
  return { ok: true, plan: { porque, pasos, olas: r.olas } }
}

export interface PlanGuardado {
  id: string
  status: string
  pedido: string
  porque: string | null
  /** De qué conversación salió, para poder anotar ahí cómo terminó. */
  threadId: string | null
  pasos: Array<
    PasoValidado & {
      id: string
      status: 'pendiente' | 'corriendo' | 'ok' | 'fallido' | 'saltado'
      resumen: string | null
      refs: Record<string, string> | null
      error: string | null
    }
  >
}

export async function guardarPlan(
  db: SupabaseClient,
  input: {
    workspaceId: string
    threadId: string | null
    pedido: string
    plan: PlanValidado
  },
): Promise<string> {
  const { data, error } = await db
    .from('operator_plans')
    .insert({
      workspace_id: input.workspaceId,
      thread_id: input.threadId,
      pedido: input.pedido.slice(0, 4000),
      porque: input.plan.porque || null,
      status: 'propuesto',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const planId = (data as { id: string }).id

  const { error: e2 } = await db.from('operator_plan_steps').insert(
    input.plan.pasos.map((p) => ({
      plan_id: planId,
      workspace_id: input.workspaceId,
      idx: p.i,
      agente: p.agente,
      que: p.que,
      encargo: p.encargo,
      depende_de: p.dependeDe,
      status: 'pendiente',
    })),
  )
  if (e2) throw new Error(e2.message)
  return planId
}

/**
 * El plan de este hilo que todavía espera un sí.
 *
 * Existe porque la tarjeta se dibujaba desde un evento del stream y nada más:
 * cerrar la pantalla la borraba, y el plan se quedaba en la base sin forma de
 * aprobarlo. Se busca por hilo y no por id porque quien vuelve no sabe cuál era.
 */
export async function planQueEspera(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<PlanGuardado | null> {
  const { data } = await db
    .from('operator_plans')
    .select('id')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'propuesto')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const fila = data as { id: string } | null
  return fila ? cargarPlan(db, fila.id, workspaceId) : null
}

export async function cargarPlan(
  db: SupabaseClient,
  planId: string,
  workspaceId: string,
): Promise<PlanGuardado | null> {
  const { data } = await db
    .from('operator_plans')
    .select('id, status, pedido, porque, thread_id')
    .eq('id', planId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!data) return null

  const { data: pasos } = await db
    .from('operator_plan_steps')
    .select('id, idx, agente, que, encargo, depende_de, status, resumen, refs, error')
    .eq('plan_id', planId)
    .eq('workspace_id', workspaceId)
    .order('idx', { ascending: true })

  const plan = data as {
    id: string
    status: string
    pedido: string
    porque: string | null
    thread_id: string | null
  }
  return {
    id: plan.id,
    status: plan.status,
    pedido: plan.pedido,
    porque: plan.porque,
    threadId: plan.thread_id,
    pasos: ((pasos ?? []) as Array<Record<string, unknown>>).map((p) => ({
      id: p.id as string,
      i: p.idx as number,
      agente: p.agente as SubagentId,
      que: ((p.que as string | null) ?? (p.encargo as string)),
      encargo: p.encargo as string,
      dependeDe: (p.depende_de as number[]) ?? [],
      status: p.status as PlanGuardado['pasos'][number]['status'],
      resumen: (p.resumen as string | null) ?? null,
      refs: (p.refs as Record<string, string> | null) ?? null,
      error: (p.error as string | null) ?? null,
    })),
  }
}

/**
 * Reclama el plan para correrlo, una sola vez.
 *
 * El UPDATE condicionado a `status='propuesto'` es el mismo truco que impide la
 * doble ejecución de una acción aprobada: dos clicks seguidos en Aprobar, o dos
 * pestañas abiertas, no pueden correr el plan dos veces. El segundo se
 * encuentra con que ya no está `propuesto` y se va sin hacer nada.
 */
export async function reclamarPlan(
  db: SupabaseClient,
  planId: string,
  workspaceId: string,
  userId: string | null,
): Promise<boolean> {
  const { data } = await db
    .from('operator_plans')
    .update({
      status: 'corriendo',
      approved_by: userId,
      started_at: new Date().toISOString(),
    })
    .eq('id', planId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'propuesto')
    .select('id')
  return Array.isArray(data) && data.length > 0
}

export async function marcarPlan(
  db: SupabaseClient,
  planId: string,
  workspaceId: string,
  status: 'terminado' | 'parcial' | 'fallido' | 'rechazado',
): Promise<void> {
  await db
    .from('operator_plans')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('workspace_id', workspaceId)
}

export async function marcarPaso(
  db: SupabaseClient,
  stepId: string,
  patch: {
    status?: 'corriendo' | 'ok' | 'fallido' | 'saltado'
    resumen?: string | null
    refs?: Record<string, string> | null
    error?: string | null
    promptTokens?: number
    completionTokens?: number
  },
): Promise<void> {
  const fila: Record<string, unknown> = {}
  if (patch.status) {
    fila.status = patch.status
    if (patch.status === 'corriendo') fila.started_at = new Date().toISOString()
    else fila.finished_at = new Date().toISOString()
  }
  if (patch.resumen !== undefined) fila.resumen = patch.resumen
  if (patch.refs !== undefined) fila.refs = patch.refs
  if (patch.error !== undefined) fila.error = patch.error
  if (patch.promptTokens !== undefined) fila.prompt_tokens = patch.promptTokens
  if (patch.completionTokens !== undefined) fila.completion_tokens = patch.completionTokens
  await db.from('operator_plan_steps').update(fila).eq('id', stepId)
}
