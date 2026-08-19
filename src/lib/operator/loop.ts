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
import { getAnthropic } from '@/lib/ai/anthropic-client'
import { resolveAnthropicKey } from '@/lib/ai/platform-key'
import {
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  findCapability,
} from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { OPERATOR_CAPABILITIES, operatorCanUse } from './capabilities'
import { OPERATOR_SYSTEM } from './prompt'

/** Techo de vueltas. Un diagnóstico honesto se resuelve en tres o cuatro. */
const MAX_ITERS = 6
const MAX_TOKENS = 2048
const MODEL = 'claude-sonnet-5'

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
): Promise<{ id: string; texto: string }> {
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
    texto: JSON.stringify({
      propuesto: true,
      action_id: id,
      nota: 'Quedó esperando aprobación. NO está hecho. Explicá qué haría y qué riesgo tiene.',
      preview,
    }),
  }
}

export async function runOperator(args: {
  db: SupabaseClient
  workspaceId: string
  userId: string
  threadId: string
  /** El hilo tal como quedó, ya en formato Anthropic. */
  history: Anthropic.MessageParam[]
  locale?: 'es' | 'en'
}): Promise<OperatorTurn> {
  const { db, workspaceId, threadId } = args

  if ((await tokensHoy(db, workspaceId)) > TOPE_DIARIO_TOKENS) {
    return {
      text: 'Llegaste al límite de uso del Operator por hoy. Volvé a intentar mañana.',
      promptTokens: 0,
      completionTokens: 0,
      proposedIds: [],
      overBudget: true,
    }
  }

  const resolved = await resolveAnthropicKey(db, { workspaceId })
  if (!resolved) throw new Error('no hay una clave de IA configurada')
  const client = getAnthropic(resolved.key)

  const ctx: CapabilityContext = {
    db,
    workspaceId,
    actor: { type: 'operator', id: args.userId },
    locale: args.locale ?? 'es',
  }

  const tools = capabilitiesAsAnthropicTools(OPERATOR_CAPABILITIES) as Anthropic.Tool[]
  const messages: Anthropic.MessageParam[] = [...args.history]
  const proposedIds: string[] = []
  let promptTokens = 0
  let completionTokens = 0

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: OPERATOR_SYSTEM,
      messages,
      tools,
    })
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

      try {
        if (cap.risk === 'lectura') {
          const salida = await cap.run(ctx, toolArgs)
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(salida).slice(0, 20_000),
          })
        } else {
          const p = await proponer(ctx, threadId, key, toolArgs)
          proposedIds.push(p.id)
          results.push({ type: 'tool_result', tool_use_id: block.id, content: p.texto })
        }
      } catch (e) {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: e instanceof Error ? e.message : 'falló',
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: results })
  }

  // Se acabaron las vueltas pidiendo herramientas: una última sin ellas para
  // que cierre con algo legible en vez de dejar la pantalla en blanco.
  const cierre = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: OPERATOR_SYSTEM,
    messages,
  })
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
