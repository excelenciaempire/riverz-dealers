import { describe, expect, it } from 'vitest'

import { olasDelPlan } from './mapa-equipo'

/**
 * Qué corre junto y qué espera.
 *
 * Es lo único que el panel tiene que decir mientras el equipo trabaja: un
 * especialista quieto se ve igual que uno colgado si no se ve de quién depende.
 */

const paso = (i: number, agente: string, dependeDe: number[] = []) =>
  ({ i, agente, encargo: 'x', dependeDe }) as never

describe('las olas de un plan', () => {
  it('lo que no se debe nada va junto', () => {
    const olas = olasDelPlan([paso(0, 'plantillas'), paso(1, 'contactos'), paso(2, 'voz')])
    expect(olas).toHaveLength(1)
    expect(olas[0].map((p) => p.agente)).toEqual(['plantillas', 'contactos', 'voz'])
  })

  it('lo que espera va debajo', () => {
    // El caso del carrito: la automatización necesita el nombre exacto de la
    // plantilla, así que no puede arrancar antes.
    const olas = olasDelPlan([paso(0, 'plantillas'), paso(1, 'automatizaciones', [0])])
    expect(olas.map((o) => o.map((p) => p.agente))).toEqual([
      ['plantillas'],
      ['automatizaciones'],
    ])
  })

  it('una cadena de tres se dibuja en tres', () => {
    const olas = olasDelPlan([paso(0, 'a'), paso(1, 'b', [0]), paso(2, 'c', [1])])
    expect(olas).toHaveLength(3)
  })

  it('un ciclo no cuelga la pantalla', () => {
    // El servidor rechaza los ciclos al validar el plan, así que esto no
    // debería llegar nunca. Un bucle infinito en el navegador sí congelaría
    // todo, y ese precio no lo paga una defensa de tres líneas.
    const olas = olasDelPlan([paso(0, 'a', [1]), paso(1, 'b', [0])])
    expect(olas).toHaveLength(1)
    expect(olas[0]).toHaveLength(2)
  })
})
