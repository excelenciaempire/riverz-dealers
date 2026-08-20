import { describe, expect, it } from 'vitest'

import type { CapabilityContext } from '@/lib/capabilities/types'
import { crearPresupuesto } from './budget'
import { fakeDb } from './fake-db'
import { diferido, fakeRunner } from './fake-runner'
import { runOrquestador } from './orchestrator'
import { runSubagent } from './run'

/**
 * Que lo que se puede hacer al mismo tiempo, se haga al mismo tiempo.
 *
 * Cuando el modelo pide dos lecturas en la misma respuesta —"mirá las etiquetas
 * y los segmentos", que es lo que hace todo el tiempo— hacerlas una tras otra
 * duplica la espera sin ahorrar un token. Una persona las mira juntas.
 *
 * Esto se rompe en silencio: volver a poner un `await` dentro del `for` deja
 * todo funcionando, sólo que el doble de lento, y no hay forma de notarlo
 * mirando la pantalla. Por eso hay una prueba.
 *
 * Cómo se mide, ya que medir tiempo no sirve: la base de mentira frena las
 * lecturas de dos tablas concretas y cuenta cuántas quedan esperando a la vez.
 * En serie nunca puede haber más de una; en paralelo hay dos. Ninguna espera
 * real, ningún reloj, y da igual en una máquina ocupada.
 */

/** Las tablas de `etiquetas.listar` y `segmentos.listar`. */
const TABLAS = new Set(['tags', 'contact_segments'])

/**
 * Deja correr todo lo que tenga que correr, sin esperar tiempo.
 *
 * Veinte vueltas de event loop: alcanza de sobra para que las dos lecturas
 * lleguen a la puerta. Si la ejecución volviera a ser en serie, la segunda
 * nunca llega y el conteo queda en uno, que es exactamente lo que la prueba
 * afirma que no puede pasar. Nada se cuelga: la puerta se suelta después de
 * medir, pase lo que pase.
 */
async function dejarCorrer(vueltas = 20) {
  for (let i = 0; i < vueltas; i++) {
    await new Promise<void>((res) => setTimeout(res, 0))
  }
}

function contadorDeLecturas() {
  const puerta = diferido()
  let ahora = 0
  let pico = 0
  const db = fakeDb({
    async antesDeLeer(tabla) {
      if (!TABLAS.has(tabla)) return
      ahora++
      pico = Math.max(pico, ahora)
      await puerta.promesa
      ahora--
    },
  })
  return { db, puerta, pico: () => pico }
}

const ctxDe = (db: ReturnType<typeof fakeDb>): CapabilityContext => ({
  db: db.db,
  workspaceId: 'ws-1',
  actor: { type: 'operator', id: 'u-1' },
  locale: 'es',
})

describe('dos lecturas de la misma respuesta', () => {
  it('las de un especialista corren a la vez', async () => {
    const { db, puerta, pico } = contadorDeLecturas()
    const fake = fakeRunner({
      contactos: [
        {
          usa: [
            { name: 'etiquetas__listar', input: {} },
            { name: 'segmentos__listar', input: {} },
          ],
        },
        { texto: 'Listo.' },
      ],
    })

    const promesa = runSubagent({
      agente: 'contactos',
      encargo: { texto: 'mirá las etiquetas y los segmentos', hechos: [] },
      ctx: ctxDe(db),
      threadId: 'th-1',
      runner: fake.runner,
      emit: () => {},
      presupuesto: crearPresupuesto(),
      autoBuild: false,
    })

    await dejarCorrer()
    const medido = pico()
    puerta.soltar()
    await promesa

    expect(medido, 'las dos lecturas tienen que estar en vuelo a la vez').toBe(2)
  })

  it('las del orquestador también', async () => {
    // Es donde más pesa: el orquestador arranca casi todos los turnos mirando
    // varias partes de la cuenta antes de decidir a quién le toca.
    const { db, puerta, pico } = contadorDeLecturas()
    const fake = fakeRunner({
      orquestador: [
        {
          usa: [
            { name: 'etiquetas__listar', input: {} },
            { name: 'segmentos__listar', input: {} },
          ],
        },
        { texto: 'Listo.' },
      ],
    })

    const promesa = runOrquestador({
      ctx: ctxDe(db),
      threadId: 'th-1',
      history: [{ role: 'user', content: 'mirá las etiquetas y los segmentos' }],
      pedido: 'mirá las etiquetas y los segmentos',
      runner: fake.runner,
      emit: () => {},
      presupuesto: crearPresupuesto(),
      autoBuild: false,
    })

    await dejarCorrer()
    const medido = pico()
    puerta.soltar()
    await promesa

    expect(medido, 'el orquestador también lee en paralelo').toBe(2)
  })
})

describe('dos escrituras de la misma respuesta', () => {
  it('van de a una y en el orden que las pidió', async () => {
    // La otra mitad de la regla, y la que importa para no romper nada: dos
    // escrituras del mismo dominio se pueden pisar. Van en serie a propósito.
    const puerta = diferido()
    let ahora = 0
    let pico = 0
    const db = fakeDb({
      async antesDeEscribir() {
        ahora++
        pico = Math.max(pico, ahora)
        await puerta.promesa
        ahora--
      },
    })

    const fake = fakeRunner({
      contactos: [
        {
          usa: [
            {
              name: 'segmentos__crear',
              input: { nombre: 'Primero', reglas: [{ type: 'shopify', op: 'is_customer' }] },
            },
            {
              name: 'segmentos__crear',
              input: { nombre: 'Segundo', reglas: [{ type: 'shopify', op: 'is_customer' }] },
            },
          ],
        },
        { texto: 'Listo.' },
      ],
    })

    const promesa = runSubagent({
      agente: 'contactos',
      encargo: { texto: 'armá dos segmentos', hechos: [] },
      ctx: ctxDe(db),
      threadId: 'th-1',
      runner: fake.runner,
      emit: () => {},
      presupuesto: crearPresupuesto(),
      autoBuild: true,
    })

    await dejarCorrer()
    const medido = pico
    puerta.soltar()
    await promesa

    expect(medido, 'una escritura por vez').toBe(1)
    expect(db.en('operator_actions').map((f) => f.capability_key)).toEqual([
      'segmentos.crear',
      'segmentos.crear',
    ])
    expect(
      db.en('operator_actions').map((f) => (f.args as { nombre: string }).nombre),
      'en el orden en que las pidió',
    ).toEqual(['Primero', 'Segundo'])
  })
})
