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
import { imageContent, type OperatorImage } from './images'

/** Cuántos turnos se le reenvían al modelo. Alcanza para seguir un hilo. */
const CONTEXT_TURNS = 20

export class OperatorThreadUnavailable extends Error {}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: OperatorImage[]
  /** El turno tal como se vio ocurrir, si se guardó. */
  bloques?: Bloque[]
  created_at: string
}

export async function ensureThread(
  db: SupabaseClient,
  input: { threadId?: string | null; workspaceId: string; userId: string; firstText: string },
): Promise<string> {
  if (input.threadId) {
    const { data, error } = await db
      .from('operator_threads')
      .select('id')
      .eq('id', input.threadId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle()
    if (error?.code === '22P02') throw new OperatorThreadUnavailable('operator_thread_unavailable')
    if (error) throw error
    if (data) return (data as { id: string }).id
    throw new OperatorThreadUnavailable('operator_thread_unavailable')
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
  const { data, error } = await db
    .from('operator_messages')
    .select('id, role, content, created_at')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200)

  if (error) throw new Error(`operator_history_failed: ${error.message}`)

  const desenlaces = await desenlaceDeCadaAccion(db, threadId, workspaceId)

  return ((data ?? []) as Array<{
    id: string
    role: 'user' | 'assistant'
    content: { text?: string; bloques?: Bloque[]; images?: OperatorImage[] }
    created_at: string
  }>).reverse().map((r) => ({
    id: r.id,
    role: r.role,
    text: r.content?.text ?? '',
    images: r.content?.images,
    // Los mensajes viejos no los tienen: ahí el hilo se ve como antes y las
    // acciones caen a la lista de abajo, que sigue existiendo justo para eso.
    bloques: Array.isArray(r.content?.bloques)
      ? conElDesenlace(r.content.bloques, desenlaces)
      : undefined,
    created_at: r.created_at,
  }))
}

/**
 * Cómo terminó cada propuesta, según la tabla y no según lo que se guardó.
 *
 * El bloque se congela en el momento en que ocurre —«propuesto»— y lo que pasó
 * después vive en `operator_actions`. Al recargar, el hilo volvía contando el
 * turno como si nadie hubiera decidido nada: tres mensajes esperando un click
 * que ya se había dado. Y el modelo leía lo mismo, así que en la vuelta
 * siguiente salía a buscar plantillas que él mismo había visto descartar.
 */
type Desenlace = 'hecho' | 'descartado' | 'error' | 'propuesto'

const POR_STATUS: Record<string, Desenlace> = {
  ejecutado: 'hecho',
  rechazado: 'descartado',
  fallido: 'error',
  propuesto: 'propuesto',
}

async function desenlaceDeCadaAccion(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<Map<string, Desenlace>> {
  const { data } = await db
    .from('operator_actions')
    .select('id, status')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)

  const m = new Map<string, Desenlace>()
  for (const a of (data ?? []) as Array<{ id: string; status: string }>) {
    const d = POR_STATUS[a.status]
    if (d) m.set(a.id, d)
  }
  return m
}

function conElDesenlace(bloques: Bloque[], desenlaces: Map<string, Desenlace>): Bloque[] {
  return bloques.map((b) => {
    if (b.k !== 'paso' || !b.actionId) return b
    const d = desenlaces.get(b.actionId)
    return d && d !== b.estado ? { ...b, estado: d } : b
  })
}

/**
 * Los últimos turnos, en el formato que espera el modelo.
 *
 * El TEXTO de lo que se propuso viaja sólo en el último turno del asistente, y
 * ahí está la diferencia entre corregir y volver a escribir: sin él, «agrégale
 * un emoji al segundo» obliga al modelo a salir a buscar una plantilla que
 * todavía no existe, no encontrarla, y redactar los tres mensajes de cero con
 * otras palabras. Con él, cambia lo que le pidieron y no toca el resto.
 *
 * Sólo el último para no arrastrar cuerpos enteros veinte turnos.
 */
export function toAnthropic(messages: ThreadMessage[]): Anthropic.MessageParam[] {
  const ventana = messages.slice(-CONTEXT_TURNS)
  // Keep the complete text window and the newest 12 images within API limits.
  let remainingImages = 12
  const visualContext = new Map<ThreadMessage, OperatorImage[]>()
  for (const message of [...ventana].reverse()) {
    if (message.role !== 'user' || !message.images?.length) continue
    const images = remainingImages > 0 ? message.images.slice(-remainingImages) : []
    remainingImages -= images.length
    visualContext.set(message, images)
  }
  const ultimoDelAsistente = ventana.map((m) => m.role).lastIndexOf('assistant')
  return ventana
    .map((m, i) => ({
      role: m.role,
      content: imageContent([m.text.trim(), loQueDejo(m, i === ultimoDelAsistente),
        m.images?.length && (visualContext.get(m)?.length ?? 0) < m.images.length
          ? '[Earlier image omitted from visual context. Do not claim to see it; ask for it again if needed.]' : '']
        .filter(Boolean)
        .join('\n\n'), visualContext.get(m)),
    }))
    .filter((m) => m.content.length > 0)
}

/** Cuánto del cuerpo de una propuesta viaja. Alcanza para editarlo. */
const TOPE_CUERPO = 600

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
 *
 * Lo DESCARTADO es la tercera cosa que hay que contar, y la que faltaba. Tocar
 * «Editar» cierra las propuestas viejas antes de mandar el pedido de cambio, así
 * que en la vuelta siguiente ya no existen en ningún lado. El modelo las
 * buscaba, no las encontraba, y concluía que nunca se habían creado: quince
 * consultas de más, los tres mensajes reescritos de cero y uno perdido en el
 * camino. Ahora se le dice que se descartaron a propósito, con el texto que
 * tenían, para que vuelva a proponerlos con el cambio pedido y nada más.
 */
function loQueDejo(m: ThreadMessage, conCuerpo: boolean): string {
  if (m.role !== 'assistant' || !m.bloques?.length) return ''

  const nombre = (b: Extract<Bloque, { k: 'paso' }>): string =>
    b.detalle?.match(/«([^»]+)»/)?.[1] ?? b.label

  /** El texto de lo que se propuso, si la pieza tiene uno. */
  const cuerpo = (b: Extract<Bloque, { k: 'paso' }>): string => {
    const a = b.artefacto as { cuerpo?: unknown } | undefined
    if (!conCuerpo || typeof a?.cuerpo !== 'string') return ''
    const t = a.cuerpo.trim()
    return t.length > TOPE_CUERPO ? `${t.slice(0, TOPE_CUERPO)}…` : t
  }

  const propuesto = new Map<string, string>()
  const descartado = new Map<string, string>()
  const hecho = new Set<string>()
  for (const b of m.bloques) {
    if (b.k !== 'paso') continue
    if (b.estado === 'propuesto') propuesto.set(nombre(b), cuerpo(b))
    else if (b.estado === 'descartado') descartado.set(nombre(b), cuerpo(b))
    else if (b.estado === 'hecho') hecho.add(nombre(b))
  }

  const conTexto = (m2: Map<string, string>): string =>
    [...m2]
      .map(([n, c]) => (c ? `«${n}» (decía: ${JSON.stringify(c)})` : `«${n}»`))
      .join(', ')

  const partes: string[] = []
  if (propuesto.size > 0) {
    partes.push(`dejaste propuesto y sin decidir: ${conTexto(propuesto)}`)
  }
  if (descartado.size > 0) {
    partes.push(
      `se descartó porque pidieron un cambio, NO existe en la cuenta y hay que volver a proponerlo: ${conTexto(descartado)}`,
    )
  }
  if (hecho.size > 0) {
    partes.push(`quedó hecho: ${[...hecho].map((n) => `«${n}»`).join(', ')}`)
  }
  // Entre corchetes y en tercera persona: es una nota del sistema sobre el
  // turno, no algo que el modelo haya dicho. Y con la regla al lado, porque el
  // dato sin la regla se lee y no se usa.
  return partes.length > 0
    ? `[En ese turno ${partes.join('; ')}. Para corregir algo de eso NO lo busques en la cuenta y NO lo escribas de cero: parte del texto de aquí arriba, REUSA el mismo nombre, cambia sólo lo que te pidieron y vuelve a proponer TODAS las piezas que seguían haciendo falta. Lo que ya está hecho no se vuelve a proponer.]`
    : ''
}

export async function appendMessage(
  db: SupabaseClient,
  input: {
    threadId: string
    workspaceId: string
    role: 'user' | 'assistant'
    text: string
    images?: OperatorImage[]
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
      ...(input.images?.length ? { images: input.images } : {}),
      ...(input.bloques && input.bloques.length > 0 ? { bloques: input.bloques } : {}),
    },
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
  })
  await db
    .from('operator_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.threadId)
    .eq('workspace_id', input.workspaceId)
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
