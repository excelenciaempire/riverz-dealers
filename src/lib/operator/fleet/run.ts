/**
 * Un subagente trabajando.
 *
 * Es el mismo loop del orquestador pero más chico y con otra salida: no le
 * escribe al comercio. Lo que dice va al panel de la derecha por
 * `agente_dice`, y lo único que sube al hilo es el resumen final, que lo lee
 * quien coordina para armar la respuesta.
 *
 * Esa separación no es estética. Si cinco subagentes emitieran texto por el
 * canal del hilo, sus frases se pegarían dentro del mismo párrafo —la pantalla
 * acumula los deltas en el último bloque, sin saber quién habló— y la respuesta
 * quedaría ilegible y sin dueño.
 *
 * Escribe por el mismo camino que el orquestador (`proponer` / `construir`), y
 * eso es lo que hace que sumar subagentes no abra un agujero: la línea entre lo
 * que se construye solo y lo que pide un click la sigue decidiendo `esInerte`,
 * en un solo lugar.
 */
import type Anthropic from '@anthropic-ai/sdk'
import {
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  esInerte,
  findCapability,
} from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import type { EmitFn } from '../events'
import { construir, proponer, recortarResultado } from '../escribir'
import type { Presupuesto } from './budget'
import { armarHecho, refsDeVarias } from './hechos'
import { encargoComoTexto, promptSubagente } from './prompts'
import { capacidadesDe, specDe } from './roster'
import { MODELOS, type ModelRunner } from './runner'
import type { Encargo, ResultadoSubagente, SubagentId } from './types'

export interface EntradaSubagente {
  agente: SubagentId
  encargo: Encargo
  ctx: CapabilityContext
  threadId: string
  runner: ModelRunner
  emit: EmitFn
  presupuesto: Presupuesto
  /** Un plan aprobado construye lo inerte sin más clicks. */
  autoBuild: boolean
  /** Índice del paso dentro del plan, cuando viene de uno. */
  paso?: number
}

export async function runSubagent(e: EntradaSubagente): Promise<ResultadoSubagente> {
  const spec = specDe(e.agente)
  const perfil = MODELOS[spec.tier]
  // El `as` es el mismo que usa el orquestador: `CapabilitySchema` es un JSON
  // Schema cerrado y el tipo del SDK pide una firma de índice abierta.
  const tools = capacidadesAnthropic(e.agente)

  e.emit({
    t: 'agente_inicio',
    agente: e.agente,
    paso: e.paso,
    encargo: e.encargo.texto,
  })

  const mensajes: Anthropic.MessageParam[] = [
    { role: 'user', content: encargoComoTexto(e.encargo) },
  ]
  const ejecutadas: Array<{ key: string; result: unknown }> = []
  const artefactos: ResultadoSubagente['artefactos'] = []
  let propuestas = 0
  let construidas = 0
  let ultimoTexto = ''

  try {
    for (let iter = 0; iter < spec.maxIters; iter++) {
      if (!e.presupuesto.puedeLlamar()) {
        // Plantarse con lo que haya, no lanzar: lo que el equipo ya construyó
        // en este turno sigue siendo válido.
        ultimoTexto ||= 'Me quedé sin presupuesto en este turno.'
        break
      }

      const res = await llamar(e, perfil, tools, mensajes)

      e.presupuesto.sumar(e.agente, {
        input: res.usage?.input_tokens,
        output: res.usage?.output_tokens,
        cacheRead: (res.usage as { cache_read_input_tokens?: number } | undefined)
          ?.cache_read_input_tokens,
      })

      const texto = textoDe(res)
      if (texto.trim()) ultimoTexto = texto.trim()

      const usos = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )
      if (usos.length === 0) break

      mensajes.push({ role: 'assistant', content: res.content })
      const resultados: Anthropic.ToolResultBlockParam[] = []

      // Las lecturas del subagente van todas juntas, por lo mismo que en el
      // orquestador: son independientes y el modelo pide varias por respuesta.
      // Las escrituras siguen en fila y en orden — dos escrituras del mismo
      // dominio pueden pisarse, y ahí el orden es parte del resultado.
      const aLeer: Anthropic.ToolUseBlock[] = []
      const aEscribir: Anthropic.ToolUseBlock[] = []
      for (const uso of usos) {
        const key = capabilityKeyFromToolName(uso.name)
        const propia = capacidadesDe(e.agente).some((c) => c.key === key)
        const cap = findCapability(key)
        if (!propia || !cap) {
          resultados.push({
            type: 'tool_result',
            tool_use_id: uso.id,
            content: `Eso no es de tu dominio (${e.agente}). Decilo y no lo intentes.`,
            is_error: true,
          })
          continue
        }
        if (cap.risk === 'lectura') aLeer.push(uso)
        else aEscribir.push(uso)
      }

      if (aLeer.length > 0) {
        const leidas = await Promise.all(
          aLeer.map(async (uso) => {
            const key = capabilityKeyFromToolName(uso.name)
            e.emit({ t: 'tool_start', id: uso.id, key, label: key, agente: e.agente })
            try {
              const salida = await findCapability(key)!.run(
                e.ctx,
                (uso.input ?? {}) as Record<string, unknown>,
              )
              e.emit({
                t: 'tool_done',
                id: uso.id,
                key,
                ok: true,
                resumen: 'ok',
                agente: e.agente,
              })
              return {
                type: 'tool_result' as const,
                tool_use_id: uso.id,
                content: recortarResultado(salida),
              }
            } catch (err) {
              const motivo = err instanceof Error ? err.message : 'falló'
              e.emit({
                t: 'tool_done',
                id: uso.id,
                key,
                ok: false,
                resumen: motivo,
                agente: e.agente,
              })
              return {
                type: 'tool_result' as const,
                tool_use_id: uso.id,
                content: motivo,
                is_error: true,
              }
            }
          }),
        )
        resultados.push(...leidas)
      }

      for (const uso of aEscribir) {
        const key = capabilityKeyFromToolName(uso.name)
        const args = (uso.input ?? {}) as Record<string, unknown>
        const cap = findCapability(key)!

        e.emit({
          t: 'tool_start',
          id: uso.id,
          key,
          label: key,
          agente: e.agente,
        })

        try {
          if (e.autoBuild && esInerte(cap, args)) {
            const c = await construir(e.ctx, e.threadId, key, args)
            construidas++
            // El resultado, no los argumentos: los argumentos son lo que se
            // pidió y el resultado es lo que quedó. Cuando el servidor
            // normaliza un nombre o resuelve un id, no son lo mismo, y el paso
            // siguiente necesita lo que quedó.
            ejecutadas.push({ key, result: c.resultado })
            if (c.artefacto) {
              artefactos.push(c.artefacto)
              e.emit({
                t: 'lienzo',
                agente: e.agente,
                paso: e.paso,
                artefacto: c.artefacto,
              })
            }
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: c.texto,
            })
            e.emit({
              t: 'built',
              id: uso.id,
              actionId: c.id,
              key,
              preview: c.preview ?? key,
              artefacto: c.artefacto ?? undefined,
              agente: e.agente,
            })
          } else {
            const p = await proponer(e.ctx, e.threadId, key, args)
            propuestas++
            if (p.artefacto) {
              artefactos.push(p.artefacto)
              e.emit({
                t: 'lienzo',
                agente: e.agente,
                paso: e.paso,
                artefacto: p.artefacto,
              })
            }
            resultados.push({
              type: 'tool_result',
              tool_use_id: uso.id,
              content: p.texto,
            })
            e.emit({
              t: 'proposed',
              id: uso.id,
              actionId: p.id,
              key,
              preview: p.preview ?? key,
              artefacto: p.artefacto ?? undefined,
              agente: e.agente,
            })
          }
        } catch (err) {
          const motivo = err instanceof Error ? err.message : 'falló'
          resultados.push({
            type: 'tool_result',
            tool_use_id: uso.id,
            content: motivo,
            is_error: true,
          })
          e.emit({
            t: 'tool_done',
            id: uso.id,
            key,
            ok: false,
            resumen: motivo,
            agente: e.agente,
          })
        }
      }

      mensajes.push({ role: 'user', content: resultados })
    }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'falló'
    e.emit({
      t: 'agente_fin',
      agente: e.agente,
      paso: e.paso,
      ok: false,
      resumen: motivo,
      propuestas,
      construidas,
    })
    return {
      agente: e.agente,
      ok: false,
      resumen: motivo,
      propuestas,
      construidas,
      artefactos,
      error: motivo,
    }
  }

  // El hecho recorta el resumen y le pega los datos duros. Se arma acá y no en
  // el emisor porque es lo mismo que sube al pizarrón y lo mismo que se
  // muestra: dos versiones distintas de "qué hizo" es cómo empiezan a no
  // coincidir la pantalla y lo que recibe el paso siguiente.
  const hecho = armarHecho(e.agente, ultimoTexto || 'Listo.', refsDeVarias(ejecutadas))

  e.emit({
    t: 'agente_fin',
    agente: e.agente,
    paso: e.paso,
    ok: true,
    resumen: hecho.resumen,
    propuestas,
    construidas,
  })

  return {
    agente: e.agente,
    ok: true,
    resumen: hecho.resumen,
    refs: hecho.refs,
    propuestas,
    construidas,
    artefactos,
  }
}

/**
 * Una vuelta, con el texto saliendo por líneas completas.
 *
 * Los deltas se juntan y se sueltan en cada salto de línea. En el panel se lee
 * "qué está haciendo el equipo", no un párrafo: con deltas haría falta un
 * reductor por agente y decidir dónde va cada pedazo; con la línea entera el
 * panel sólo agrega a una lista.
 */
async function llamar(
  e: EntradaSubagente,
  perfil: (typeof MODELOS)[keyof typeof MODELOS],
  tools: Anthropic.Tool[],
  mensajes: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  let buffer = ''
  /** Suelta las líneas completas y se queda con lo que quedó a medias. */
  const soltarLineas = () => {
    const partes = buffer.split('\n')
    buffer = partes.pop() ?? ''
    for (const linea of partes) {
      const l = linea.trim()
      if (l) e.emit({ t: 'agente_dice', agente: e.agente, texto: l })
    }
  }

  const res = await e.runner(
    {
      quien: e.agente,
      model: perfil.model,
      // El prompt del subagente va en un bloque cacheado. Es constante por
      // dominio y se reenviaba entero en cada vuelta de cada especialista: con
      // catorce dominios y varias vueltas cada uno, era lo más caro del turno
      // después del hilo. El encargo y los hechos van en `messages`, así que
      // este prefijo es idéntico entre comercios y entre turnos.
      system: [
        {
          type: 'text' as const,
          text: promptSubagente(e.agente),
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: mensajes,
      tools,
      maxTokens: perfil.maxTokens,
      effort: perfil.effort,
    },
    (d) => {
      if (d.tipo !== 'texto') return
      buffer += d.delta
      if (buffer.includes('\n')) soltarLineas()
    },
  )

  // Lo último casi nunca termina en salto de línea; sin este cierre, la frase
  // que resume el trabajo se perdería justo al final.
  const resto = buffer.trim()
  if (resto) e.emit({ t: 'agente_dice', agente: e.agente, texto: resto })

  return res
}

function capacidadesAnthropic(agente: SubagentId): Anthropic.Tool[] {
  return capabilitiesAsAnthropicTools(capacidadesDe(agente)) as Anthropic.Tool[]
}

function textoDe(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}
