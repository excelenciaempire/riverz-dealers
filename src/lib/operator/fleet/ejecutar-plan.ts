/**
 * El equipo trabajando sobre un plan aprobado.
 *
 * Corre por OLAS: los pasos que no se deben nada arrancan juntos, y los que
 * dependen de otro esperan a que ése termine. "Armá recuperación de carritos"
 * son dos olas de a uno, porque la automatización necesita el nombre de la
 * plantilla. "Revisá plantillas y contá el público" es una sola ola de a dos, y
 * hacerlos en fila sería tiempo tirado delante de alguien que está mirando.
 *
 * Tres decisiones que importan:
 *
 *  - **`allSettled` y no `Promise.all`.** Un subagente que explota no puede
 *    llevarse puestos a los otros dos de su ola, que ya terminaron su trabajo.
 *  - **Semáforo de tres.** El único reparto paralelo que ya existía en el repo
 *    (`instagram-agent/send.ts`) usa `Promise.all` crudo sin límite. Funciona
 *    porque el lote es de veinticinco y nadie mira. Acá hay alguien mirando, la
 *    clave es la de la plataforma, y un 429 sin reintentos se pierde entero.
 *  - **Lo que falla arrastra a lo que dependía, pero como `saltado`.** "No se
 *    pudo" y "ni se intentó" son dos cosas distintas en pantalla: mezclarlas
 *    hace creer que se rompieron cinco cosas cuando se rompió una.
 *
 * No hay rollback y no hace falta: lo que un subagente dejó creado quedó
 * apagado o quedó propuesto. Nada queda a medio prender.
 */
import type { CapabilityContext } from '@/lib/capabilities/types'
import type { EmitFn } from '../events'
import { crearSemaforo, type Presupuesto } from './budget'
import { alcanzadosPor } from './olas'
import { marcarPaso, marcarPlan, type PlanGuardado } from './plan'
import { mapaDelTurno } from './orchestrator'
import { runSubagent } from './run'
import type { ModelRunner } from './runner'
import type { Hecho, ResultadoSubagente } from './types'

export interface ResultadoPlan {
  estado: 'terminado' | 'parcial' | 'fallido'
  pasos: Array<{
    i: number
    agente: string
    estado: 'ok' | 'fallido' | 'saltado'
    resumen: string
  }>
  propuestas: number
  construidas: number
}

export async function ejecutarPlan(args: {
  plan: PlanGuardado
  ctx: CapabilityContext
  threadId: string
  runner: ModelRunner
  emit: EmitFn
  presupuesto: Presupuesto
}): Promise<ResultadoPlan> {
  const { plan, ctx, emit } = args
  const conCupo = crearSemaforo()
  // Correr un plan es otra petición HTTP: el mapa que cargó el turno anterior
  // ya no está, y sin él los especialistas vuelven a trabajar a ciegas.
  const mapa = await mapaDelTurno(ctx)

  // Los hechos van por índice de paso: cada uno recibe SÓLO los de aquellos de
  // los que depende. Pasarle todo a todos sería llenarle el contexto de cosas
  // que no le tocan y que puede confundir con su propio encargo.
  const hechoDe = new Map<number, Hecho>()
  const estadoDe = new Map<number, 'ok' | 'fallido' | 'saltado'>()
  const resumenDe = new Map<number, string>()
  let propuestas = 0
  let construidas = 0

  const olas = agruparEnOlas(plan)

  for (const ola of olas) {
    // Lo que ya se cayó arrastra a lo que venía atrás: no se intenta.
    const pendientes = ola.filter((i) => !estadoDe.has(i))
    if (pendientes.length === 0) continue

    const corridas = await Promise.allSettled(
      pendientes.map((i) =>
        conCupo(async () => {
          const paso = plan.pasos.find((p) => p.i === i)!
          await marcarPaso(ctx.db, paso.id, { status: 'corriendo' })

          const hechos = paso.dependeDe
            .map((d) => hechoDe.get(d))
            .filter((h): h is Hecho => !!h)

          const r = await runSubagent({
            agente: paso.agente,
            encargo: { texto: paso.encargo, hechos },
            ctx,
            threadId: args.threadId,
            runner: args.runner,
            emit,
            presupuesto: args.presupuesto,
            // Un plan aprobado construye lo inerte sin más clicks. Lo que no es
            // inerte sigue proponiendo, adentro del plan y fuera de él.
            autoBuild: true,
            paso: i,
            mapa,
          })
          return { i, paso, r }
        }),
      ),
    )

    for (const c of corridas) {
      if (c.status === 'rejected') {
        // El semáforo o el propio `runSubagent` no deberían rechazar nunca
        // —los errores del modelo se devuelven como `ok:false`— pero si pasa,
        // el plan no se cae: ese paso queda fallido y sigue el resto.
        continue
      }
      const { i, paso, r } = c.value as { i: number; paso: PlanGuardado['pasos'][number]; r: ResultadoSubagente }
      propuestas += r.propuestas
      construidas += r.construidas

      /**
       * Un paso que no dejó nada a la vista, cuenta por qué.
       *
       * Un especialista puede terminar su turno perfectamente y no haber hecho
       * nada: le faltó un dato, se trabó pidiéndole a otro, o su encargo era
       * mirar. En los tres casos su resumen es lo único que explica la pantalla
       * vacía, y no se mostraba en ningún lado — ni ahí, ni en el cierre.
       *
       * Con algo construido o propuesto no hace falta: la tarjeta y el panel de
       * la derecha ya lo dicen, y repetirlo sería contar dos veces lo mismo.
       */
      if (r.propuestas === 0 && r.construidas === 0 && r.resumen.trim()) {
        emit({ t: 'text', delta: `\n\n${r.resumen.trim()}` })
      }

      if (r.ok) {
        estadoDe.set(i, 'ok')
        resumenDe.set(i, r.resumen)
        hechoDe.set(i, { de: r.agente, resumen: r.resumen, refs: r.refs })
        await marcarPaso(ctx.db, paso.id, {
          status: 'ok',
          resumen: r.resumen,
          refs: r.refs ?? null,
        })
      } else {
        estadoDe.set(i, 'fallido')
        resumenDe.set(i, r.error ?? 'falló')
        await marcarPaso(ctx.db, paso.id, {
          status: 'fallido',
          resumen: r.resumen,
          error: r.error ?? 'falló',
        })
      }
    }

    // Marcar como saltado lo que dependía de algo que se cayó, para que la ola
    // siguiente no lo intente y para que en pantalla se vea la diferencia.
    const caidos = [...estadoDe.entries()].filter(([, e]) => e === 'fallido').map(([i]) => i)
    if (caidos.length > 0) {
      const muertos = alcanzadosPor(
        plan.pasos.map((p) => ({ i: p.i, dependeDe: p.dependeDe })),
        caidos,
      )
      for (const i of muertos) {
        if (estadoDe.has(i)) continue
        estadoDe.set(i, 'saltado')
        const paso = plan.pasos.find((p) => p.i === i)!
        await marcarPaso(ctx.db, paso.id, {
          status: 'saltado',
          error: 'No se intentó porque falló un paso del que dependía.',
        })
        emit({
          t: 'agente_fin',
          agente: paso.agente,
          paso: i,
          ok: false,
          resumen: 'No se intentó: falló un paso del que dependía.',
          propuestas: 0,
          construidas: 0,
        })
      }
    }
  }

  const hubo = (e: 'ok' | 'fallido' | 'saltado') =>
    [...estadoDe.values()].some((x) => x === e)
  const estado: ResultadoPlan['estado'] = !hubo('ok')
    ? 'fallido'
    : hubo('fallido') || hubo('saltado')
      ? 'parcial'
      : 'terminado'

  await marcarPlan(ctx.db, plan.id, ctx.workspaceId, estado)
  emit({ t: 'plan_estado', planId: plan.id, estado })

  return {
    estado,
    pasos: plan.pasos.map((p) => ({
      i: p.i,
      agente: p.agente,
      estado: estadoDe.get(p.i) ?? 'saltado',
      resumen: resumenDe.get(p.i) ?? '',
    })),
    propuestas,
    construidas,
  }
}

/**
 * Las olas de un plan ya guardado.
 *
 * Se recalculan al ejecutar en vez de guardarlas: las dependencias están en la
 * base y el orden se deduce de ellas. Guardar el orden además de las
 * dependencias sería tener dos fuentes de la misma verdad, y la que se
 * desactualiza siempre es la copia.
 */
function agruparEnOlas(plan: PlanGuardado): number[][] {
  const listos = new Set<number>()
  const olas: number[][] = []
  let vueltas = 0

  while (listos.size < plan.pasos.length && vueltas++ <= plan.pasos.length) {
    const ola = plan.pasos
      .filter((p) => !listos.has(p.i))
      .filter((p) => p.dependeDe.every((d) => listos.has(d)))
      .map((p) => p.i)
    // Un ciclo no debería llegar acá: `validarPlan` lo rechaza al guardar. Si
    // igual llegara, se corta en vez de girar para siempre.
    if (ola.length === 0) break
    ola.forEach((i) => listos.add(i))
    olas.push(ola)
  }
  return olas
}
