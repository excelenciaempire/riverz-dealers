/**
 * El turno del orquestador.
 *
 * Vive aparte del loop de siempre y no lo modifica. Con el flag del equipo
 * apagado, `runOperator` corre exactamente el código que corría ayer: ése es el
 * rollback, y vale más que ahorrarse sesenta líneas de andamio parecido.
 *
 * Lo que cambia respecto del loop clásico:
 *
 *  - **Tiene las lecturas y dos herramientas de equipo, nada más.** Las
 *    escrituras se mudaron a los especialistas. Efecto de costado bueno: su
 *    prompt se achica y su prefijo se cachea igual para toda la plataforma.
 *  - **Dos pasadas sobre las herramientas de una misma respuesta.** Las
 *    lecturas y el plan van en fila, como siempre; las delegaciones van juntas,
 *    con semáforo. Un pedido con tres encargos independientes tarda lo que el
 *    más lento y no la suma de los tres.
 *  - **Una delegación no gasta una vuelta.** Delegar es trabajo hecho, no una
 *    vuelta desperdiciada. El techo lo ponen el total de vueltas y el
 *    presupuesto, no el contador de razonamiento.
 */
import type Anthropic from '@anthropic-ai/sdk'
import {
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  findCapability,
} from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { cargarMapa, mapaComoTexto } from '../account-map'
import type { EmitFn } from '../events'
import { recortarResultado } from '../escribir'
import { OPERATOR_CAPABILITIES } from '../capabilities'
import { crearSemaforo, type Presupuesto } from './budget'
import { ejecutarPlan } from './ejecutar-plan'
import { leerIntencion, pistaComoTexto } from './intencion'
import { cargarPlan, guardarPlan, validarPlan } from './plan'
import { PROMPT_ORQUESTADOR, TOOLS_EQUIPO, esToolDeEquipo } from './orchestrator-tools'
import { rosterComoTexto } from './roster'
import { runSubagent } from './run'
import { MODELOS, type ModelRunner } from './runner'
import type { Hecho, SubagentId } from './types'
import { esSubagentId } from './types'

/** Vueltas de razonamiento. Las delegaciones no cuentan acá. */
const MAX_VUELTAS = 6
/** Techo duro del turno, delegaciones incluidas. */
const MAX_ITERS_TOTAL = 14
const MAX_DELEGACIONES = 8

export interface TurnoOrquestador {
  text: string
  promptTokens: number
  completionTokens: number
  proposedIds: string[]
  planId?: string
}

export async function runOrquestador(args: {
  ctx: CapabilityContext
  threadId: string
  history: Anthropic.MessageParam[]
  pedido: string
  runner: ModelRunner
  emit: EmitFn
  presupuesto: Presupuesto
  autoBuild: boolean
}): Promise<TurnoOrquestador> {
  const { ctx, emit, presupuesto } = args

  // Las lecturas, y nada más: construir es trabajo de los especialistas.
  const lecturas = OPERATOR_CAPABILITIES.filter((c) => c.risk === 'lectura')
  const tools = [
    ...(capabilitiesAsAnthropicTools(lecturas) as Anthropic.Tool[]),
    ...TOOLS_EQUIPO,
  ]

  const system = await armarSystem(ctx, args.pedido)
  const messages: Anthropic.MessageParam[] = [...args.history]
  const proposedIds: string[] = []
  let planId: string | undefined
  let vueltas = 0
  let iter = 0
  let delegaciones = 0
  let ultimoTexto = ''

  while (vueltas < MAX_VUELTAS && iter < MAX_ITERS_TOTAL) {
    iter++
    emit({ t: 'step', n: vueltas + 1, de: MAX_VUELTAS })

    if (!presupuesto.puedeLlamar()) break
    const res = await llamar(args, system, tools, messages)
    presupuesto.sumar('orquestador', {
      input: res.usage?.input_tokens,
      output: res.usage?.output_tokens,
      cacheRead: (res.usage as { cache_read_input_tokens?: number } | undefined)
        ?.cache_read_input_tokens,
    })

    const texto = textoDe(res)
    if (texto.trim()) ultimoTexto = texto.trim()
    if (res.stop_reason !== 'tool_use') {
      return {
        text: ultimoTexto,
        ...presupuesto.total(),
        proposedIds,
        planId,
      }
    }

    messages.push({ role: 'assistant', content: res.content })
    const usos = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    const results: Anthropic.ToolResultBlockParam[] = []
    const aDelegar: Anthropic.ToolUseBlock[] = []

    // ── Pasada 1: lo que va en fila ────────────────────────────────────
    for (const uso of usos) {
      if (uso.name === 'equipo__delegar') {
        aDelegar.push(uso)
        continue
      }

      if (uso.name === 'equipo__plan') {
        const r = await manejarPlan(args, uso)
        results.push(r.result)
        if (r.planId) planId = r.planId
        continue
      }

      const key = capabilityKeyFromToolName(uso.name)
      const cap = findCapability(key)
      // El portero se vuelve a preguntar acá y no sólo al armar las tools: el
      // nombre lo elige el modelo. Y el orquestador sólo lee.
      if (!cap || cap.risk !== 'lectura') {
        results.push({
          type: 'tool_result',
          tool_use_id: uso.id,
          content: `${uso.name} no la podés usar vos. Si cambia algo, delegala al especialista del dominio.`,
          is_error: true,
        })
        continue
      }

      emit({ t: 'tool_start', id: uso.id, key, label: key })
      try {
        const salida = await cap.run(ctx, (uso.input ?? {}) as Record<string, unknown>)
        results.push({
          type: 'tool_result',
          tool_use_id: uso.id,
          content: recortarResultado(salida),
        })
        emit({ t: 'tool_done', id: uso.id, key, ok: true, resumen: 'ok' })
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'falló'
        results.push({
          type: 'tool_result',
          tool_use_id: uso.id,
          content: motivo,
          is_error: true,
        })
        emit({ t: 'tool_done', id: uso.id, key, ok: false, resumen: motivo })
      }
    }

    // ── Pasada 2: los encargos, juntos ─────────────────────────────────
    if (aDelegar.length > 0) {
      const conCupo = crearSemaforo()
      const corridas = await Promise.allSettled(
        aDelegar.map((uso) =>
          conCupo(async () => {
            const input = (uso.input ?? {}) as { subagente?: unknown; encargo?: unknown }
            if (!esSubagentId(input.subagente)) {
              return {
                uso,
                error: `"${String(input.subagente)}" no está en el equipo.`,
              }
            }
            const r = await runSubagent({
              agente: input.subagente,
              encargo: { texto: String(input.encargo ?? ''), hechos: [] },
              ctx,
              threadId: args.threadId,
              runner: args.runner,
              emit,
              presupuesto,
              autoBuild: args.autoBuild,
            })
            proposedIds.push(...Array(r.propuestas).fill(''))
            return { uso, r }
          }),
        ),
      )

      for (const c of corridas) {
        if (c.status === 'rejected') continue
        const v = c.value as {
          uso: Anthropic.ToolUseBlock
          r?: Awaited<ReturnType<typeof runSubagent>>
          error?: string
        }
        if (v.error || !v.r) {
          results.push({
            type: 'tool_result',
            tool_use_id: v.uso.id,
            content: v.error ?? 'no se pudo delegar',
            is_error: true,
          })
          continue
        }
        results.push({
          type: 'tool_result',
          tool_use_id: v.uso.id,
          content: JSON.stringify({
            agente: v.r.agente,
            ok: v.r.ok,
            resumen: v.r.resumen,
            datos: v.r.refs,
            propuestas: v.r.propuestas,
            construidas: v.r.construidas,
          }),
          is_error: !v.r.ok,
        })
      }

      delegaciones += aDelegar.length
      if (delegaciones >= MAX_DELEGACIONES) {
        results.push({
          type: 'tool_result',
          tool_use_id: aDelegar[0].id,
          content: 'Ya delegaste bastante en este turno. Cerrá contando qué quedó.',
        })
      }
    }

    messages.push({ role: 'user', content: results })
    // La vuelta sólo se cuenta si NO hubo delegación: delegar es trabajo hecho.
    if (aDelegar.length === 0) vueltas++
  }

  // Se acabaron las vueltas: una última sin herramientas, para cerrar con algo
  // legible en vez de dejar la pantalla en blanco.
  if (presupuesto.puedeLlamar()) {
    const cierre = await llamar(args, system, [], messages)
    presupuesto.sumar('orquestador', {
      input: cierre.usage?.input_tokens,
      output: cierre.usage?.output_tokens,
    })
    const t = textoDe(cierre).trim()
    if (t) ultimoTexto = t
  }

  return { text: ultimoTexto, ...presupuesto.total(), proposedIds, planId }
}

/**
 * El plan: se guarda y se muestra, no se ejecuta.
 *
 * Devolverle al modelo "quedó esperando aprobación" y no un resultado es lo que
 * hace que el reparto lo pueda decidir un modelo: si se equivoca, se lee y se
 * rechaza antes de que pase nada.
 */
async function manejarPlan(
  args: Parameters<typeof runOrquestador>[0],
  uso: Anthropic.ToolUseBlock,
): Promise<{ result: Anthropic.ToolResultBlockParam; planId?: string }> {
  const v = validarPlan(uso.input)
  if (!v.ok) {
    return {
      result: {
        type: 'tool_result',
        tool_use_id: uso.id,
        content: `${v.error} Corregí el plan y volvé a mandarlo.`,
        is_error: true,
      },
    }
  }

  const planId = await guardarPlan(args.ctx.db, {
    workspaceId: args.ctx.workspaceId,
    threadId: args.threadId,
    pedido: args.pedido,
    plan: v.plan,
  })

  args.emit({
    t: 'plan',
    planId,
    porque: v.plan.porque,
    pasos: v.plan.pasos.map((p) => ({
      i: p.i,
      agente: p.agente,
      encargo: p.encargo,
      dependeDe: p.dependeDe,
    })),
  })

  return {
    planId,
    result: {
      type: 'tool_result',
      tool_use_id: uso.id,
      content: JSON.stringify({
        plan_id: planId,
        estado: 'esperando_aprobacion',
        nota: 'El reparto quedó a la vista y espera un click. NO está hecho. Contá en una línea qué va a hacer el equipo y no digas que ya está.',
      }),
    },
  }
}

/**
 * El prompt del sistema, en dos bloques.
 *
 * El primero —instrucciones y equipo— es idéntico entre comercios y entre
 * turnos, así que se cachea para toda la plataforma. El segundo es el mapa de
 * la cuenta, que cambia por comercio: si fuera antes del corte, el caché no
 * acertaría nunca y nadie se enteraría, porque funcionar funciona igual.
 */
async function armarSystem(
  ctx: CapabilityContext,
  pedido: string,
): Promise<Anthropic.TextBlockParam[]> {
  const estable = `${PROMPT_ORQUESTADOR}\n\nEL EQUIPO\n${rosterComoTexto()}`

  let mapa = ''
  try {
    mapa = mapaComoTexto(await cargarMapa(ctx.db, ctx.workspaceId))
  } catch {
    // Sin mapa el turno sigue: el equipo va a consultar lo que necesite. Sin
    // turno, no hay nada.
    mapa = ''
  }

  const pista = pistaComoTexto(leerIntencion(pedido))
  const variable = [mapa, pista].filter(Boolean).join('\n\n')

  return [
    { type: 'text', text: estable, cache_control: { type: 'ephemeral' } },
    ...(variable ? [{ type: 'text' as const, text: variable }] : []),
  ]
}

async function llamar(
  args: Parameters<typeof runOrquestador>[0],
  system: Anthropic.TextBlockParam[],
  tools: Anthropic.Tool[],
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  return args.runner(
    {
      quien: 'orquestador',
      model: MODELOS.orquestador.model,
      system,
      messages,
      tools,
      maxTokens: MODELOS.orquestador.maxTokens,
      effort: MODELOS.orquestador.effort,
    },
    (d) => {
      // El orquestador SÍ escribe en el hilo: es el único que lo hace.
      if (d.tipo === 'texto') args.emit({ t: 'text', delta: d.delta })
      else args.emit({ t: 'thinking', delta: d.delta })
    },
  )
}

function textoDe(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

export { ejecutarPlan, cargarPlan, esToolDeEquipo }
export type { Hecho, SubagentId }
