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
import { IMAGE_CONTEXT_PROMPT } from '../images'
import {
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  findCapability,
} from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { etiquetaDe } from '../etiquetas'
import { cargarMapa, mapaComoTexto } from '../account-map'
import { pliegoDeLaCuenta } from '@/lib/operacion/contexto'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'
import type { EmitFn } from '../events'
import { recortarResultado, vistaDe } from '../escribir'
import { operatorCapabilitiesForWorkspace, operatorCanUse } from '../capabilities'
import { crearSemaforo, type Presupuesto } from './budget'
import { ejecutarPlan } from './ejecutar-plan'
import { leerIntencion, pistaComoTexto } from './intencion'
import { cargarPlan, guardarPlan, validarPlan } from './plan'
import { PROMPT_ORQUESTADOR, TOOLS_EQUIPO, esToolDeEquipo } from './orchestrator-tools'
import { PREGUNTAR_ORQUESTADOR } from './preguntas'
import { rosterComoTexto } from './roster'
import { runSubagent } from './run'
import { MODELOS, type ModelRunner } from './runner'
import type { Hecho, SubagentId } from './types'
import { esSubagentId } from './types'

/** Vueltas de razonamiento. Las delegaciones no cuentan acá. */
const MAX_VUELTAS = 6
/** Techo duro del turno, delegaciones incluidas. */
const MAX_ITERS_TOTAL = 24
const MAX_DELEGACIONES = 16

export interface TurnoOrquestador {
  text: string
  promptTokens: number
  completionTokens: number
  /** Lo que le costo a Riverz este turno, en USD. */
  costoUsd: number
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
  /**
   * ¿Alguien pidió detener?
   *
   * Se pregunta entre vueltas y no a mitad de una: cortar durante una llamada
   * al modelo deja a medio hacer justo lo que se estaba haciendo, y la vuelta
   * ya está pagada.
   */
  detener?: () => Promise<boolean>
}): Promise<TurnoOrquestador> {
  const { ctx, emit, presupuesto } = args

  // Las lecturas, y nada más: construir es trabajo de los especialistas.
  const lecturas = operatorCapabilitiesForWorkspace(ctx.workspaceId).filter((c) => c.risk === 'lectura')
  const tools = [
    ...(capabilitiesAsAnthropicTools(lecturas) as Anthropic.Tool[]),
    ...TOOLS_EQUIPO,
  ]

  // El mapa se carga UNA vez y viaja a los especialistas: sin él trabajan a
  // ciegas y terminan inventando un nombre de etiqueta o de plantilla.
  const mapa = await mapaDelTurno(ctx)
  const system = armarSystem(mapa, args.pedido)
  const messages: Anthropic.MessageParam[] = [...args.history]
  const proposedIds: string[] = []
  let planId: string | undefined
  let vueltas = 0
  let iter = 0
  let delegaciones = 0
  let ultimoTexto = ''
  // Un turno son varias llamadas al modelo, y el hilo las muestra como un solo
  // mensaje. Sin esto, la última frase de una llamada y la primera de la
  // siguiente salían pegadas: "…antes de enviarla.Dejé el plan esperando".
  // `planListo` apaga el texto que viene DESPUÉS de guardar un plan. La nota de
  // la herramienta pide no repetirlo y el modelo igual escribe un párrafo que
  // dice lo mismo que el de arriba: el bloqueo que ya contó, otra vez. Si
  // todavía no había dicho nada, lo deja pasar, para no dejar la tarjeta sola
  // sin una palabra.
  const hilo = { yaEscribio: false, planListo: false }
  const mudo = () => hilo.planListo && hilo.yaEscribio

  while (vueltas < MAX_VUELTAS && iter < MAX_ITERS_TOTAL) {
    iter++
    if (await args.detener?.()) break
    emit({ t: 'step', n: vueltas + 1, de: MAX_VUELTAS })

    if (!presupuesto.puedeLlamar()) break
    // Se pregunta ANTES: la primera frase de esta llamada prende `yaEscribio`,
    // así que preguntarlo después daría mudo en la llamada que sí habló.
    const eraMudo = mudo()
    const res = await llamar(args, system, tools, messages, hilo)
    presupuesto.sumar(
      'orquestador',
      {
        input: res.usage?.input_tokens,
        output: res.usage?.output_tokens,
        cacheRead: (res.usage as { cache_read_input_tokens?: number } | undefined)
          ?.cache_read_input_tokens,
        cacheWrite: (res.usage as { cache_creation_input_tokens?: number } | undefined)
          ?.cache_creation_input_tokens,
      },
      MODELOS.orquestador.model,
    )

    const texto = textoDe(res)
    if (texto.trim() && !eraMudo) ultimoTexto = texto.trim()
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

    // ── Pasada 1: el plan en fila, las lecturas todas juntas ───────────
    //
    // Las lecturas se piden en paralelo porque son independientes entre sí y
    // porque el modelo casi siempre pide varias en la misma respuesta: "mirá
    // las recetas y las automatizaciones" son dos consultas que no se deben
    // nada. En fila, cada una esperaba a la anterior; medido en la primera
    // corrida real, cuatro lecturas seguidas eran cuatro viajes a la base uno
    // atrás del otro.
    //
    // El plan NO entra en el grupo: escribe en la base y emite un evento, y su
    // lugar en el orden importa.
    const aLeer: Anthropic.ToolUseBlock[] = []
    for (const uso of usos) {
      if (uso.name === 'equipo__delegar') {
        aDelegar.push(uso)
        continue
      }

      if (uso.name === 'equipo__plan') {
        const r = await manejarPlan(args, uso)
        results.push(r.result)
        if (r.planId) {
          planId = r.planId
          hilo.planListo = true
        }
        continue
      }

      const key = capabilityKeyFromToolName(uso.name)
      const cap = findCapability(key)
      // El portero se vuelve a preguntar acá y no sólo al armar las tools: el
      // nombre lo elige el modelo. Y el orquestador sólo lee.
      if (!cap || cap.risk !== 'lectura' || !operatorCanUse(key, ctx.workspaceId)) {
        results.push({
          type: 'tool_result',
          tool_use_id: uso.id,
          content: `${uso.name} no la puedes usar tú. Si cambia algo, delégala al especialista del dominio.`,
          is_error: true,
        })
        continue
      }
      aLeer.push(uso)
    }

    if (aLeer.length > 0) {
      const leidas = await Promise.all(
        aLeer.map(async (uso) => {
          const key = capabilityKeyFromToolName(uso.name)
          const suya = findCapability(key)!
          emit({ t: 'tool_start', id: uso.id, key, label: etiquetaDe(suya, ctx.locale) })
          try {
            const argsLectura = (uso.input ?? {}) as Record<string, unknown>
            const salida = await suya.run(ctx, argsLectura)
            emit({
              t: 'tool_done',
              id: uso.id,
              key,
              ok: true,
              resumen: 'ok',
              lectura: true,
              // El orquestador tiene sus PROPIAS lecturas: las que miran la
              // cuenta entera y no un dominio (métricas, salud). Sin esto,
              // justo las tres preguntas más comunes —«¿cómo vamos?», «¿cuánto
              // vendimos?», «¿qué está roto?»— dejaban el panel vacío.
              vista: vistaDe(suya, ctx, argsLectura, salida) ?? undefined,
            })
            return {
              type: 'tool_result' as const,
              tool_use_id: uso.id,
              content: recortarResultado(salida),
            }
          } catch (e) {
            const motivo = e instanceof Error ? e.message : 'falló'
            emit({ t: 'tool_done', id: uso.id, key, ok: false, resumen: motivo, lectura: true })
            return {
              type: 'tool_result' as const,
              tool_use_id: uso.id,
              content: motivo,
              is_error: true,
            }
          }
        }),
      )
      results.push(...leidas)
    }

    // ── Pasada 2: los encargos, juntos ─────────────────────────────────
    if (aDelegar.length > 0) {
      const conCupo = crearSemaforo()
      /**
       * Nada de esto puede lanzar.
       *
       * La API exige un `tool_result` por cada `tool_use` de la respuesta
       * anterior. Un encargo que rechazaba se saltaba con `continue` y dejaba
       * su id sin contestar, así que la llamada siguiente moría con un 400 y el
       * turno entero se perdía con un «algo salió mal» — justo cuando algo ya
       * había fallado y hacía falta contarlo. Ahora el error viaja como
       * resultado, que es lo que el modelo puede leer y explicar.
       */
      const corridas = await Promise.all(
        aDelegar.map((uso, n) =>
          conCupo(async () => {
            const input = (uso.input ?? {}) as { subagente?: unknown; encargo?: unknown }
            if (!esSubagentId(input.subagente)) {
              return {
                uso,
                error: `"${String(input.subagente)}" no está en el equipo.`,
              }
            }
            // El techo es real y no un consejo: contaba las delegaciones para
            // avisar, pero nada impedía seguir delegando hasta el techo de
            // vueltas. Un encargo por encima del tope vuelve como error suyo,
            // con su propio id contestado.
            if (delegaciones + n >= MAX_DELEGACIONES) {
              return {
                uso,
                error: `Ya delegaste ${MAX_DELEGACIONES} veces en este turno. Cierra contando qué quedó y qué falta.`,
              }
            }
            try {
              const r = await runSubagent({
                agente: input.subagente,
                encargo: { texto: String(input.encargo ?? ''), hechos: [] },
                ctx,
                threadId: args.threadId,
                runner: args.runner,
                emit,
                presupuesto,
                autoBuild: args.autoBuild,
                mapa,
              })
              proposedIds.push(...Array(r.propuestas).fill(''))
              return { uso, r }
            } catch (err) {
              return { uso, error: err instanceof Error ? err.message : 'falló' }
            }
          }),
        ),
      )

      for (const v of corridas) {
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
            /**
             * El aviso va ACÁ, no sólo en el prompt.
             *
             * Es el momento exacto en que el orquestador decide qué hace
             * después, y una regla en un system prompt largo se pierde. Sin
             * esto seguía de largo: el de plantillas dejaba el mensaje
             * propuesto, el orquestador pedía la automatización que lo manda, y
             * la plantilla no existía todavía.
             *
             * Y decía «cierra el turno diciendo qué queda por decidir», que es
             * justo lo que no hay que decir: la tarjeta con los botones ya está
             * en pantalla. De ahí salían todos los cierres que terminaban en
             * «esperando aprobación».
             */
            ...(v.r.propuestas > 0
              ? {
                  aviso:
                    'Lo que quedó propuesto TODAVÍA NO EXISTE: espera a que lo aprueben antes de construir nada que lo use. Cierra el turno acá, sin describir lo que propusiste ni anunciar lo que harás después: la tarjeta con los botones ya está a la vista.',
                }
              : {}),
          }),
          is_error: !v.r.ok,
        })
      }

      delegaciones += aDelegar.length
    }

    /**
     * Ni una herramienta sin respuesta.
     *
     * La API exige un `tool_result` por cada `tool_use` de la respuesta
     * anterior, y si falta uno la llamada siguiente muere con un 400 que en
     * pantalla se lee «algo salió mal». Cada rama de arriba deja la suya, así
     * que esto no debería encontrar nada: es el cinturón, porque el precio de
     * un descuido acá es el turno entero.
     */
    const contestadas = new Set(results.map((r) => r.tool_use_id))
    for (const uso of usos) {
      if (contestadas.has(uso.id)) continue
      results.push({
        type: 'tool_result',
        tool_use_id: uso.id,
        content: 'No se pudo ejecutar.',
        is_error: true,
      })
    }

    messages.push({ role: 'user', content: results })
    // La vuelta sólo se cuenta si NO hubo delegación: delegar es trabajo hecho.
    if (aDelegar.length === 0) vueltas++
  }

  // Se acabaron las vueltas: una última sin herramientas, para cerrar con algo
  // legible en vez de dejar la pantalla en blanco.
  if (presupuesto.puedeLlamar()) {
    const cerroMudo = mudo()
    const cierre = await llamar(args, system, [], messages, hilo)
    presupuesto.sumar('orquestador', {
      input: cierre.usage?.input_tokens,
      output: cierre.usage?.output_tokens,
    })
    const t = textoDe(cierre).trim()
    if (t && !cerroMudo) ultimoTexto = t
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
        content: `${v.error} Corrige el plan y vuelve a mandarlo.`,
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
      que: p.que,
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
        // Esta nota es lo último que el modelo lee antes de escribir, así que
        // pesa más que cualquier regla del prompt del sistema. Decía "cuenta
        // en una línea qué va a hacer el equipo", y el modelo obedecía: volvía
        // a narrar el reparto que la tarjeta ya mostraba, a veces dos veces.
        nota:
          'El reparto YA está en pantalla, con sus pasos numerados y el botón para aprobar. '
          + 'NO lo describas ni lo repitas: quien te habla lo está viendo. '
          + 'Si queda algo que la tarjeta no dice (qué falta conectar, qué elegiste y por qué), dilo en UNA frase. '
          + 'Si no queda nada, no escribas nada más. Y no digas que está hecho, porque no lo está.',
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
/**
 * Lo que hay en la cuenta y lo que el comercio dejó dicho, en texto.
 *
 * Son dos cosas distintas y las dos hacen falta. El mapa dice QUÉ EXISTE
 * —agentes, plantillas, automatizaciones, canales—; el pliego dice QUÉ SE
 * PUEDE: hasta cuánto descuento, si se puede reembolsar, a qué hora se
 * escribe. Con el mapa solo, el equipo sabe dónde está parado pero elige por su
 * cuenta las decisiones que no le corresponden.
 *
 * Cualquiera de las dos puede fallar sin arrastrar a la otra: sin mapa el turno
 * sigue y el equipo consulta lo que necesite; sin pliego, sigue con los mínimos
 * seguros. Sin turno, no hay nada.
 */
export async function mapaDelTurno(ctx: CapabilityContext): Promise<string> {
  const [mapa, pliego] = await Promise.all([
    cargarMapa(ctx.db, ctx.workspaceId)
      .then(mapaComoTexto)
      .catch(() => ''),
    pliegoDeLaCuenta(ctx.db, ctx.workspaceId, ctx.locale ?? DEFAULT_LOCALE).catch(
      () => '',
    ),
  ])
  return [mapa, pliego].filter(Boolean).join('\n\n')
}

function armarSystem(mapa: string, pedido: string): Anthropic.TextBlockParam[] {
  // Las preguntas entran en el bloque estable: son las mismas para todos los
  // comercios, así que viajan gratis dentro del prefijo cacheado.
  const estable = `${PROMPT_ORQUESTADOR}\n\n${PREGUNTAR_ORQUESTADOR}\n\n${IMAGE_CONTEXT_PROMPT}\n\nEL EQUIPO\n${rosterComoTexto()}`

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
  hilo: { yaEscribio: boolean; planListo: boolean },
): Promise<Anthropic.Message> {
  let abrio = false
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
      if (d.tipo !== 'texto') {
        args.emit({ t: 'thinking', delta: d.delta })
        return
      }
      // Con el plan ya en pantalla y algo ya dicho, lo que siga sobra.
      if (hilo.planListo && hilo.yaEscribio) return
      if (!abrio) {
        abrio = true
        if (hilo.yaEscribio) args.emit({ t: 'text', delta: '\n\n' })
        hilo.yaEscribio = true
      }
      args.emit({ t: 'text', delta: d.delta })
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
