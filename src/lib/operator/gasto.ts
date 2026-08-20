/**
 * Cuánto gastó cada uno del equipo, guardado.
 *
 * El total del turno ya cae en `operator_messages`, que es de donde el techo
 * diario saca su número: eso no cambia y no hace falta tocarlo. Lo que se
 * guarda acá es el DESGLOSE, y existe para contestar una pregunta concreta que
 * decide el precio del producto: ¿el gasto se va en el orquestador repartiendo,
 * o en los especialistas construyendo? Son dos problemas distintos y se
 * arreglan distinto.
 *
 * Va a su propia tabla y no a `operator_messages` porque esa tabla es el
 * historial de la conversación: se lee con un tope de doscientas filas para
 * armar el contexto del modelo, y meterle filas que no son mensajes las hace
 * competir con los mensajes por ese cupo.
 *
 * Nunca puede tumbar un turno. Si falla, se pierde una estadística; si tirara,
 * se perdería el trabajo que el equipo ya hizo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GastoAgente } from './fleet/budget'

export async function guardarGasto(
  db: SupabaseClient,
  input: {
    workspaceId: string
    threadId: string
    porAgente: Record<string, GastoAgente>
  },
): Promise<void> {
  const filas = Object.entries(input.porAgente).map(([agente, g]) => ({
    workspace_id: input.workspaceId,
    thread_id: input.threadId,
    agente,
    prompt_tokens: g.prompt,
    completion_tokens: g.completion,
    cache_read_tokens: g.cache,
    llamadas: g.llamadas,
  }))
  if (filas.length === 0) return
  try {
    await db.from('operator_agent_usage').insert(filas)
  } catch {
    /* una estadística perdida no vale un turno perdido */
  }
}
