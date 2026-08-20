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
import { crearPresupuesto, type GastoAgente } from './fleet/budget'
import { runOrquestador } from './fleet/orchestrator'
import { anthropicRunner, type ModelRunner } from './fleet/runner'
import type { EmitFn } from './events'
import { resolveAnthropicKey } from '@/lib/ai/platform-key'
import {
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  esInerte,
  findCapability,
} from '@/lib/capabilities/registry'
import type { Capability, CapabilityContext } from '@/lib/capabilities/types'
import { OPERATOR_CAPABILITIES, operatorCanUse } from './capabilities'
import { construir, proponer } from './escribir'
import { etiquetaDe } from './etiquetas'
import { systemPrompt } from './prompt'
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
  args: {
    messages: Anthropic.MessageParam[]
    tools: Anthropic.Tool[]
    system: string
  },
  emit: EmitFn,
): Promise<Anthropic.Message> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: args.system,
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
 * No hay techo diario de gasto por cuenta.
 *
 * Hubo uno de 400.000 tokens de entrada, y el problema no era el número sino
 * que estaba elegido a ojo: cortaba una tarde de trabajo real igual que un
 * bucle. El freno de un bucle es el límite por minuto del endpoint, que sigue
 * puesto; y el gasto real ahora se guarda desglosado por subagente en
 * `operator_agent_usage`, que es de donde va a salir el número definitivo
 * cuando haya con qué elegirlo.
 *
 * `overBudget` y su texto se quedan: el día que vuelva un tope, vuelve acá.
 */

export interface OperatorTurn {
  text: string
  promptTokens: number
  completionTokens: number
  /** Acciones que quedaron esperando aprobación en esta vuelta. */
  proposedIds: string[]
  /** Se acabó el cupo del día: no se llamó al modelo. */
  overBudget?: boolean
  /**
   * Cuánto gastó cada uno del equipo. Sólo en el camino con equipo.
   *
   * El total sigue cayendo en la fila del turno, que es de donde el techo
   * diario saca su número. Esto es el desglose, y sin él no se puede contestar
   * la pregunta que decide el precio: si el gasto se va en repartir o en
   * construir.
   */
  porAgente?: Record<string, GastoAgente>
  /** El reparto que quedó esperando aprobación, si hubo. */
  planId?: string
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
  /**
   * Modo automático: construye lo inerte sin preguntar. Lo que se prende o le
   * llega a una persona sigue pidiendo un click igual.
   */
  autoBuild?: boolean
  /**
   * El Operator con equipo.
   *
   * Cuando está prendido, el turno lo corre el orquestador de
   * `fleet/orchestrator.ts`, que reparte entre especialistas. Cuando no, corre
   * exactamente el código de abajo, sin una línea de diferencia: ése es el
   * rollback, y por eso el camino nuevo vive en otro archivo en vez de
   * entretejerse con banderas acá.
   */
  flota?: boolean
  /**
   * El modelo, inyectable. Sólo lo usa el camino con equipo, y existe para
   * poder probar el reparto sin gastar saldo de la API.
   */
  runner?: ModelRunner
  /** Lo último que escribió la persona, para la pista de intención. */
  pedido?: string
}): Promise<OperatorTurn> {
  const { db, workspaceId, threadId } = args
  const emit: EmitFn = args.onEvent ?? (() => {})

  const locale = args.locale ?? 'es'

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

  // ── El camino con equipo ─────────────────────────────────────────────
  // Se bifurca acá, después de resolver la clave y el presupuesto, que son los
  // mismos para los dos caminos. De acá para abajo no se toca nada.
  if (args.flota) {
    const presupuesto = crearPresupuesto()
    const turno = await runOrquestador({
      ctx,
      threadId,
      history: args.history,
      pedido: args.pedido ?? '',
      // El cliente de streaming, no el de subagente. Es la diferencia entre
      // diez minutos y dos: el orquestador es el que tiene a una persona
      // mirando la pantalla, y un turno con reparto se pasa de dos minutos sin
      // que nada esté mal. Los subagentes sí usan el corto, que lo arma
      // `runSubagent` por su cuenta.
      runner: args.runner ?? anthropicRunner(getAnthropicStreaming(resolved.key)),
      emit,
      presupuesto,
      autoBuild: args.autoBuild === true,
    })
    emit({
      t: 'gasto',
      promptTokens: turno.promptTokens,
      completionTokens: turno.completionTokens,
      porAgente: Object.fromEntries(
        Object.entries(presupuesto.porAgente()).map(([k, v]) => [k, v.prompt + v.completion]),
      ),
    })
    return {
      text: turno.text,
      promptTokens: turno.promptTokens,
      completionTokens: turno.completionTokens,
      proposedIds: turno.proposedIds,
      porAgente: presupuesto.porAgente(),
      planId: turno.planId,
    }
  }

  // El prompt cambia con el modo: decirle "nunca ejecutás" mientras la
  // herramienta sí ejecuta hacía que contara como propuesta algo ya creado.
  const system = systemPrompt(args.autoBuild === true)
  const tools = capabilitiesAsAnthropicTools(OPERATOR_CAPABILITIES) as Anthropic.Tool[]
  const messages: Anthropic.MessageParam[] = [...args.history]
  const proposedIds: string[] = []
  let promptTokens = 0
  let completionTokens = 0

  /**
   * Usar una herramienta ya validada. Nunca tira: un fallo vuelve como
   * resultado de error para que el modelo lo lea y siga.
   */
  const usar = async (
    block: Anthropic.ToolUseBlock,
    cap: Capability,
  ): Promise<Anthropic.ToolResultBlockParam> => {
    const key = cap.key
    const toolArgs = (block.input ?? {}) as Record<string, unknown>
    emit({ t: 'tool_start', id: block.id, key, label: etiquetaDe(cap, locale) })

    try {
      if (cap.risk === 'lectura') {
        const salida = await cap.run(ctx, toolArgs)
        const texto = JSON.stringify(salida).slice(0, 20_000)
        emit({ t: 'tool_done', id: block.id, key, ok: true, resumen: resumirSalida(salida) })
        return { type: 'tool_result', tool_use_id: block.id, content: texto }
      }

      if (args.autoBuild && esInerte(cap, toolArgs)) {
        // Modo automático: lo que deja algo APAGADO se construye en el
        // momento y se ve aparecer. Lo que se prende o le llega a una
        // persona cae igual al camino de abajo, en los dos modos.
        const c = await construir(ctx, threadId, key, toolArgs)
        emit({
          t: 'built',
          id: block.id,
          actionId: c.id,
          key,
          preview: c.preview ?? key,
          artefacto: c.artefacto ?? undefined,
        })
        return { type: 'tool_result', tool_use_id: block.id, content: c.texto }
      }

      const p = await proponer(ctx, threadId, key, toolArgs)
      proposedIds.push(p.id)
      emit({
        t: 'proposed',
        id: block.id,
        actionId: p.id,
        key,
        preview: p.preview ?? key,
        artefacto: p.artefacto ?? undefined,
      })
      return { type: 'tool_result', tool_use_id: block.id, content: p.texto }
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'falló'
      emit({ t: 'tool_done', id: block.id, key, ok: false, resumen: motivo })
      return { type: 'tool_result', tool_use_id: block.id, content: motivo, is_error: true }
    }
  }

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    emit({ t: 'step', n: iter + 1, de: MAX_ITERS })
    const res = await transmitir(client, { messages, tools, system }, emit)
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

    // Cuando el modelo pide tres lecturas en la misma respuesta —"mirá las
    // recetas y las automatizaciones", que es lo que hace todo el tiempo— no
    // hay motivo para hacerlas una tras otra: una persona las mira al mismo
    // tiempo. Las lecturas van juntas; lo que cambia algo sigue en serie y en
    // el orden en que lo pidió, porque dos escrituras del mismo dominio se
    // pueden pisar.
    const aLeer: { block: Anthropic.ToolUseBlock; cap: Capability }[] = []
    const aEscribir: { block: Anthropic.ToolUseBlock; cap: Capability }[] = []

    for (const block of res.content) {
      if (block.type !== 'tool_use') continue
      const key = capabilityKeyFromToolName(block.name)

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

      ;(cap.risk === 'lectura' ? aLeer : aEscribir).push({ block, cap })
    }

    if (aLeer.length > 0) {
      results.push(...(await Promise.all(aLeer.map((u) => usar(u.block, u.cap)))))
    }
    for (const u of aEscribir) results.push(await usar(u.block, u.cap))

    messages.push({ role: 'user', content: results })
  }

  // Se acabaron las vueltas pidiendo herramientas: una última sin ellas para
  // que cierre con algo legible en vez de dejar la pantalla en blanco.
  const cierre = await transmitir(client, { messages, tools: [], system }, emit)
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
