/**
 * El hilo de conversación con el Operator.
 *
 * Se guardan sólo los turnos de texto —lo que preguntó la persona y lo que
 * contestó el Operator—, no las llamadas a herramientas ni lo que devolvieron.
 * Es deliberado: el estado de la cuenta cambia todo el tiempo, y arrastrar las
 * métricas de hace una hora dentro del contexto haría que el Operator conteste
 * con datos viejos en la vuelta siguiente. Si necesita el dato otra vez, lo
 * vuelve a pedir y lo trae fresco.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Bloque } from './bloques'
import { titleFrom } from './prompt'

/** Cuántos turnos se le reenvían al modelo. Alcanza para seguir un hilo. */
const CONTEXT_TURNS = 20

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** El turno tal como se vio ocurrir, si se guardó. */
  bloques?: Bloque[]
  created_at: string
}

export async function ensureThread(
  db: SupabaseClient,
  input: { threadId?: string | null; workspaceId: string; userId: string; firstText: string },
): Promise<string> {
  if (input.threadId) {
    const { data } = await db
      .from('operator_threads')
      .select('id')
      .eq('id', input.threadId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle()
    if (data) return (data as { id: string }).id
  }

  const { data, error } = await db
    .from('operator_threads')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      title: titleFrom(input.firstText),
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function loadMessages(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<ThreadMessage[]> {
  const { data } = await db
    .from('operator_messages')
    .select('id, role, content, created_at')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(200)

  return ((data ?? []) as Array<{
    id: string
    role: 'user' | 'assistant'
    content: { text?: string; bloques?: Bloque[] }
    created_at: string
  }>).map((r) => ({
    id: r.id,
    role: r.role,
    text: r.content?.text ?? '',
    // Los mensajes viejos no los tienen: ahí el hilo se ve como antes y las
    // acciones caen a la lista de abajo, que sigue existiendo justo para eso.
    bloques: Array.isArray(r.content?.bloques) ? r.content.bloques : undefined,
    created_at: r.created_at,
  }))
}

/** Los últimos turnos, en el formato que espera el modelo. */
export function toAnthropic(messages: ThreadMessage[]): Anthropic.MessageParam[] {
  return messages
    .slice(-CONTEXT_TURNS)
    .map((m) => ({ role: m.role, content: [m.text.trim(), loQueDejo(m)].filter(Boolean).join('\n\n') }))
    .filter((m) => m.content.length > 0)
}

/**
 * Qué quedó de aquel turno, para que el modelo lo sepa en el siguiente.
 *
 * Se mandaba sólo el texto. Los nombres exactos de lo que se propuso o se
 * construyó viven en los bloques —se guardan desde hace rato— y no viajaban, así
 * que en la vuelta siguiente el modelo no tenía forma de saber qué había hecho.
 *
 * Se vio en una cuenta real: se pidió cambiar dos de tres mensajes, el
 * especialista volvió a escribir los tres con NOMBRES NUEVOS, y quedaron seis
 * esperando aprobación. También explica por qué, después de aprobar, volvía a
 * proponer el mismo plan: no le constaba que ya estuviera hecho.
 */
function loQueDejo(m: ThreadMessage): string {
  if (m.role !== 'assistant' || !m.bloques?.length) return ''

  const nombre = (b: Extract<Bloque, { k: 'paso' }>): string =>
    b.detalle?.match(/«([^»]+)»/)?.[1] ?? b.label

  const propuesto = new Set<string>()
  const hecho = new Set<string>()
  for (const b of m.bloques) {
    if (b.k !== 'paso') continue
    if (b.estado === 'propuesto') propuesto.add(nombre(b))
    else if (b.estado === 'hecho') hecho.add(nombre(b))
  }

  const partes: string[] = []
  if (propuesto.size > 0) {
    partes.push(`dejaste esperando aprobación: ${[...propuesto].map((n) => `«${n}»`).join(', ')}`)
  }
  if (hecho.size > 0) {
    partes.push(`quedó hecho: ${[...hecho].map((n) => `«${n}»`).join(', ')}`)
  }
  // Entre corchetes y en tercera persona: es una nota del sistema sobre el
  // turno, no algo que el modelo haya dicho. Y con la regla al lado, porque el
  // dato sin la regla se lee y no se usa.
  return partes.length > 0
    ? `[En ese turno ${partes.join('; ')}. Si hay que corregir algo de eso, REUSA el mismo nombre en vez de inventar uno nuevo, y no vuelvas a proponer lo que ya está hecho.]`
    : ''
}

export async function appendMessage(
  db: SupabaseClient,
  input: {
    threadId: string
    workspaceId: string
    role: 'user' | 'assistant'
    text: string
    /**
     * El turno tal como se vio ocurrir.
     *
     * `content` ya era `jsonb` y guardaba sólo `{text}`, así que esto no
     * necesita migración. Sin guardarlo, al recargar una conversación el hilo
     * volvía como un párrafo pelado: los pasos desaparecían y TODAS las
     * acciones del historial se amontonaban al final, lejos del momento en que
     * ocurrieron.
     */
    bloques?: Bloque[]
    promptTokens?: number
    completionTokens?: number
  },
): Promise<void> {
  await db.from('operator_messages').insert({
    thread_id: input.threadId,
    workspace_id: input.workspaceId,
    role: input.role,
    content: {
      text: input.text,
      ...(input.bloques && input.bloques.length > 0 ? { bloques: input.bloques } : {}),
    },
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
  })
  await db
    .from('operator_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.threadId)
}

export async function loadActions(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
) {
  const { data } = await db
    .from('operator_actions')
    .select('id, capability_key, args, risk, status, preview, artifact, result, created_at')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  return data ?? []
}

export interface ResumenHilo {
  id: string
  titulo: string
  actualizado: string
  /** Cuántos turnos tiene: sirve para no ofrecer hilos vacíos. */
  mensajes: number
  /** Cuántas decisiones quedaron esperando en ese hilo. */
  pendientes: number
}

/** Cuántos hilos se listan. Más que esto ya nadie los busca en una lista. */
const TOPE_HILOS = 40

/**
 * Las conversaciones anteriores del comercio.
 *
 * Cada hilo es su propio contexto: lo que se habló en uno no entra en el otro.
 * Eso ya era cierto en el servidor —el contexto se arma con `loadMessages` de
 * UN hilo— pero no se podía usar, porque la pantalla abría un hilo nuevo en
 * cada carga y no había forma de volver a ninguno. Se guardaba todo y no se
 * leía nada.
 *
 * Los conteos se piden de a uno y no con un `join`: PostgREST devuelve los
 * agregados anidados como filas embebidas, así que un `join` acá traería todos
 * los mensajes de los cuarenta hilos para contarlos en memoria. Cuarenta
 * consultas con `head: true` no traen ni una fila.
 */
export async function listarHilos(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ResumenHilo[]> {
  const { data } = await db
    .from('operator_threads')
    .select('id, title, updated_at, created_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(TOPE_HILOS)

  const hilos = (data ?? []) as Array<{
    id: string
    title: string | null
    updated_at: string | null
    created_at: string
  }>
  if (hilos.length === 0) return []

  const conteos = await Promise.all(
    hilos.map(async (h) => {
      const [msgs, pend] = await Promise.all([
        db
          .from('operator_messages')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', h.id)
          .eq('workspace_id', workspaceId),
        db
          .from('operator_actions')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', h.id)
          .eq('workspace_id', workspaceId)
          .eq('status', 'propuesto'),
      ])
      return { mensajes: msgs.count ?? 0, pendientes: pend.count ?? 0 }
    }),
  )

  return hilos
    .map((h, i) => ({
      id: h.id,
      titulo: (h.title ?? '').trim() || 'Sin título',
      actualizado: h.updated_at ?? h.created_at,
      mensajes: conteos[i].mensajes,
      pendientes: conteos[i].pendientes,
    }))
    // Un hilo sin mensajes es una conversación que se abrió y se abandonó antes
    // de escribir nada: ofrecerla sólo ensucia la lista.
    .filter((h) => h.mensajes > 0)
}

/**
 * Borra un hilo y todo lo suyo.
 *
 * Las acciones NO se borran: se las desata del hilo. Una automatización que se
 * creó de verdad sigue existiendo en la cuenta después de borrar la
 * conversación, y su registro de auditoría tiene que sobrevivir a que alguien
 * limpie el historial. Borrar el rastro de lo que se hizo sería la forma más
 * fácil de esconder un cambio.
 */
export async function borrarHilo(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await db
    .from('operator_threads')
    .select('id')
    .eq('id', threadId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!data) return false

  await db
    .from('operator_actions')
    .update({ thread_id: null })
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
  await db
    .from('operator_messages')
    .delete()
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
  await db
    .from('operator_threads')
    .delete()
    .eq('id', threadId)
    .eq('workspace_id', workspaceId)
  return true
}
