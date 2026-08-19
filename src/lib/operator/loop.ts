/**
 * El loop del Operator.
 *
 * Parecido al del agente que atiende clientes, con una diferencia que es toda
 * la seguridad del sistema: acá el modelo ejecuta SÓLO las herramientas de
 * lectura. Cualquier otra queda anotada como propuesta en `operator_actions` y
 * el loop le devuelve al modelo "quedó propuesta", no un resultado.
 *
 * Eso hace que una instrucción hostil escondida en el mensaje de un cliente
 * —que el Operator lee cuando diagnostica— no pueda cambiar nada: en el peor
 * caso deja una propuesta que una persona va a ver antes de aprobar, con los
 * argumentos a la vista.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicStreaming } from '@/lib/ai/anthropic-client'
import type { EmitFn } from './events'
import { resolveAnthropicKey } from '@/lib/ai/platform-key'
import {
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  findCapability,
} from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { OPERATOR_CAPABILITIES, operatorCanUse } from './capabilities'
import { OPERATOR_SYSTEM } from './prompt'
import { translate } from '@/lib/i18n/translate'

/** Techo de vueltas. Un diagnóstico honesto se resuelve en tres o cuatro. */
const MAX_ITERS = 6
const MAX_TOKENS = 4096
const MODEL = 'claude-sonnet-5'

/**
 * Cuánto piensa antes de contestar.
 *
 * El razonamiento se muestra en pantalla: es la parte donde se ve que eligió
 * una receta sobre otra por el objetivo de la marca, y no que adivinó.
 *
 * `adaptive` y no un presupuesto fijo de tokens: este modelo rechaza
 * `thinking.type.enabled` y pide manejarlo con `output_config.effort`, que es
 * además la forma correcta — piensa lo que el problema necesita en vez de
 * gastar siempre lo mismo. `medium` porque acá se decide sobre la cuenta de un
 * comercio; `low` es para clasificar y resumir.
 */
const EFFORT = 'medium' as const

/**
 * Una vuelta del modelo, transmitida.
 *
 * Los deltas de pensamiento y de texto salen por separado porque en la pantalla
 * son dos cosas distintas: uno es lo que está considerando y el otro lo que te
 * está diciendo. Mezclarlos haría que el razonamiento parezca la respuesta.
 */
async function transmitir(
  client: Anthropic,
  args: { messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] },
  emit: EmitFn,
): Promise<Anthropic.Message> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: OPERATOR_SYSTEM,
    messages: args.messages,
    ...(args.tools.length > 0 ? { tools: args.tools } : {}),
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
  })

  for await (const ev of stream) {
    if (ev.type !== 'content_block_delta') continue
    if (ev.delta.type === 'text_delta') emit({ t: 'text', delta: ev.delta.text })
    else if (ev.delta.type === 'thinking_delta') {
      emit({ t: 'thinking', delta: ev.delta.thinking })
    }
  }

  // El mensaje final trae los bloques completos —incluidos los de pensamiento—
  // y hay que devolverlos tal cual al historial: con razonamiento activado, la
  // API rechaza un turno de herramientas al que le falten.
  return stream.finalMessage()
}

/**
 * Techo diario de gasto por cuenta.
 *
 * El Operator corre con la clave de Riverz, así que sin tope una cuenta puede
 * gastar sin límite el saldo de la plataforma. Se cuenta en tokens de entrada
 * porque es lo que domina: cada vuelta reenvía el hilo entero.
 */
const TOPE_DIARIO_TOKENS = 400_000

export interface OperatorTurn {
  text: string
  promptTokens: number
  completionTokens: number
  /** Acciones que quedaron esperando aprobación en esta vuelta. */
  proposedIds: string[]
  /** Se acabó el cupo del día: no se llamó al modelo. */
  overBudget?: boolean
}

async function tokensHoy(db: SupabaseClient, workspaceId: string): Promise<number> {
  const desde = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const { data } = await db
    .from('operator_messages')
    .select('prompt_tokens')
    .eq('workspace_id', workspaceId)
    .gte('created_at', desde)
  return ((data ?? []) as { prompt_tokens: number | null }[]).reduce(
    (a, r) => a + (r.prompt_tokens ?? 0),
    0,
  )
}

/**
 * Anota una acción que cambia algo y devuelve qué contestarle al modelo.
 *
 * El `preview` se calcula en el servidor y no lo escribe el modelo: es lo que
 * la persona va a leer antes de aprobar, así que tiene que describir lo que
 * realmente se va a ejecutar.
 */
async function proponer(
  ctx: CapabilityContext,
  threadId: string,
  key: string,
  args: Record<string, unknown>,
): Promise<{ id: string; preview: string | null; texto: string }> {
  const cap = findCapability(key)!
  let preview: string | null = null
  try {
    preview = cap.preview ? await cap.preview(ctx, args) : null
  } catch (e) {
    preview = e instanceof Error ? e.message : null
  }

  const { data, error } = await ctx.db
    .from('operator_actions')
    .insert({
      workspace_id: ctx.workspaceId,
      thread_id: threadId,
      capability_key: key,
      args,
      risk: cap.risk,
      preview,
      status: 'propuesto',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const id = (data as { id: string }).id
  return {
    id,
    preview,
    texto: JSON.stringify({
      propuesto: true,
      action_id: id,
      nota: 'Quedó esperando aprobación. NO está hecho. Explicá qué haría y qué riesgo tiene.',
      preview,
    }),
  }
}

/**
 * Un nombre corto para la pantalla, sacado de la descripción.
 *
 * La descripción está escrita para el modelo y son dos renglones: mostrarla
 * entera convierte la lista de pasos en un muro. La primera cláusula sí sirve
 * —"Panorama de la cuenta", "Cómo viene la cuenta en un período"— y es lo único
 * que se necesita mientras el paso corre.
 *
 * Es el respaldo: la pantalla prefiere su propia etiqueta cuando la capacidad
 * está en su mapa. Esto es lo que se ve cuando alguien suma una capacidad nueva
 * y todavía no le puso nombre corto.
 */
function etiquetaDe(descripcion: string): string {
  const primera = descripcion.split(/[:.,;]/)[0].trim()
  return primera.length > 60 ? `${primera.slice(0, 57)}…` : primera
}

/**
 * Una línea de lo que devolvió una lectura, para la pantalla.
 *
 * El resultado crudo puede tener miles de caracteres y es para el modelo, no
 * para una persona. Acá alcanza con el tamaño: lo que se está mostrando es que
 * la consulta salió bien y trajo algo.
 */
function resumirSalida(salida: unknown): string {
  if (Array.isArray(salida)) return `${salida.length}`
  if (salida && typeof salida === 'object') {
    return Object.keys(salida as Record<string, unknown>).length.toString()
  }
  return 'ok'
}

export async function runOperator(args: {
  db: SupabaseClient
  workspaceId: string
  userId: string
  threadId: string
  /** El hilo tal como quedó, ya en formato Anthropic. */
  history: Anthropic.MessageParam[]
  locale?: 'es' | 'en'
  /**
   * Progreso en vivo. Sin esto el turno se comporta como antes: corre entero y
   * devuelve el resultado al final.
   */
  onEvent?: EmitFn
}): Promise<OperatorTurn> {
  const { db, workspaceId, threadId } = args
  const emit: EmitFn = args.onEvent ?? (() => {})

  const locale = args.locale ?? 'es'

  if ((await tokensHoy(db, workspaceId)) > TOPE_DIARIO_TOKENS) {
    return {
      text: translate(locale, 'operation.operatorOverBudget'),
      promptTokens: 0,
      completionTokens: 0,
      proposedIds: [],
      overBudget: true,
    }
  }

  // Sin clave no se puede contestar, pero tampoco es un error del comercio:
  // es que la cuenta no tiene la IA habilitada. Tirar una excepción dejaba en
  // pantalla un "no hay una clave de IA configurada" que no le dice a nadie
  // qué hacer.
  const resolved = await resolveAnthropicKey(db, { workspaceId })
  if (!resolved) {
    return {
      text: translate(locale, 'operation.operatorNoKey'),
      promptTokens: 0,
      completionTokens: 0,
      proposedIds: [],
      overBudget: true,
    }
  }
  const client = getAnthropicStreaming(resolved.key)

  const ctx: CapabilityContext = {
    db,
    workspaceId,
    actor: { type: 'operator', id: args.userId },
    locale,
  }

  const tools = capabilitiesAsAnthropicTools(OPERATOR_CAPABILITIES) as Anthropic.Tool[]
  const messages: Anthropic.MessageParam[] = [...args.history]
  const proposedIds: string[] = []
  let promptTokens = 0
  let completionTokens = 0

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    emit({ t: 'step', n: iter + 1, de: MAX_ITERS })
    const res = await transmitir(client, { messages, tools }, emit)
    promptTokens += res.usage?.input_tokens ?? 0
    completionTokens += res.usage?.output_tokens ?? 0

    if (res.stop_reason !== 'tool_use') {
      return {
        text: textoDe(res),
        promptTokens,
        completionTokens,
        proposedIds,
      }
    }

    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []

    for (const block of res.content) {
      if (block.type !== 'tool_use') continue
      const key = capabilityKeyFromToolName(block.name)
      const toolArgs = (block.input ?? {}) as Record<string, unknown>

      // La lista de habilitadas se vuelve a mirar acá y no sólo al armar las
      // tools: el nombre lo elige el modelo.
      if (!operatorCanUse(key)) {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `La herramienta ${block.name} no está disponible.`,
          is_error: true,
        })
        continue
      }

      const cap = findCapability(key)
      if (!cap) {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `No existe la herramienta ${block.name}.`,
          is_error: true,
        })
        continue
      }

      emit({ t: 'tool_start', id: block.id, key, label: etiquetaDe(cap.description) })

      try {
        if (cap.risk === 'lectura') {
          const salida = await cap.run(ctx, toolArgs)
          const texto = JSON.stringify(salida).slice(0, 20_000)
          emit({
            t: 'tool_done',
            id: block.id,
            key,
            ok: true,
            resumen: resumirSalida(salida),
          })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: texto })
        } else {
          const p = await proponer(ctx, threadId, key, toolArgs)
          proposedIds.push(p.id)
          emit({
            t: 'proposed',
            id: block.id,
            actionId: p.id,
            key,
            preview: p.preview ?? key,
          })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: p.texto })
        }
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'falló'
        emit({ t: 'tool_done', id: block.id, key, ok: false, resumen: motivo })
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: motivo,
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: results })
  }

  // Se acabaron las vueltas pidiendo herramientas: una última sin ellas para
  // que cierre con algo legible en vez de dejar la pantalla en blanco.
  const cierre = await transmitir(client, { messages, tools: [] }, emit)
  promptTokens += cierre.usage?.input_tokens ?? 0
  completionTokens += cierre.usage?.output_tokens ?? 0
  return { text: textoDe(cierre), promptTokens, completionTokens, proposedIds }
}

function textoDe(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}
