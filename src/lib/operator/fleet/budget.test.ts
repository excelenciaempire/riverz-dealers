import { describe, expect, it } from 'vitest'

import { MAX_LLAMADAS_TURNO, crearPresupuesto, crearSemaforo } from './budget'
import { diferido } from './fake-runner'

/**
 * El presupuesto del turno y el semáforo.
 *
 * Lo que se prueba acá no es aritmética: es que el gasto de los subagentes
 * llegue hasta el total del turno. Ése es el número que después alimenta el
 * techo diario, y si se queda corto la cuenta del día siguiente arranca
 * creyendo que no se gastó nada.
 */

describe('el presupuesto del turno', () => {
  it('suma lo del orquestador y lo de cada subagente', () => {
    const p = crearPresupuesto()
    p.sumar('orquestador', { input: 100, output: 20 })
    p.sumar('plantillas', { input: 300, output: 50 })
    p.sumar('automatizaciones', { input: 400, output: 80 })
    expect(p.total()).toMatchObject({ promptTokens: 800, completionTokens: 150 })
  })

  it('el costo sale del modelo de cada llamada, no de un promedio', () => {
    // Un token de Haiku no vale lo que uno del modelo grande: sumar tokens y
    // multiplicar por un promedio da un número que no se parece a la factura.
    const caro = crearPresupuesto()
    caro.sumar('orquestador', { input: 1000, output: 1000 }, 'claude-opus-5')
    const barato = crearPresupuesto()
    barato.sumar('plantillas', { input: 1000, output: 1000 }, 'claude-haiku-4-5-20251001')
    expect(caro.total().costoUsd).toBeGreaterThan(barato.total().costoUsd)
  })

  it('la caché entra en el costo, que es donde se va la plata', () => {
    // `input_tokens` NO incluye la caché: sin sumarla, el costo del Operador
    // es un piso y no una medición.
    const con = crearPresupuesto()
    con.sumar('orquestador', { input: 100, cacheRead: 50_000 }, 'claude-opus-5')
    const sin = crearPresupuesto()
    sin.sumar('orquestador', { input: 100 }, 'claude-opus-5')
    expect(con.total().costoUsd).toBeGreaterThan(sin.total().costoUsd)
  })

  it('el desglose por agente cuenta también las llamadas', () => {
    const p = crearPresupuesto()
    p.sumar('plantillas', { input: 10, output: 1 })
    p.sumar('plantillas', { input: 20, output: 2, cacheRead: 500 })
    expect(p.porAgente().plantillas).toEqual({
      prompt: 30,
      completion: 3,
      cache: 500,
      llamadas: 2,
    })
  })

  it('un uso ausente no rompe la cuenta', () => {
    // La API puede no devolver `usage` en un error parcial. Perder la
    // atribución es aceptable; perder el turno entero, no.
    const p = crearPresupuesto()
    p.sumar('bandeja', null)
    p.sumar('bandeja', { input: 5 })
    expect(p.total()).toMatchObject({ promptTokens: 5, completionTokens: 0 })
    expect(p.porAgente().bandeja.llamadas).toBe(2)
  })

  it('se planta al llegar al techo, sin lanzar', () => {
    // Contestar con lo que haya es molesto; explotar pierde todo lo que el
    // equipo ya construyó en ese turno.
    const p = crearPresupuesto(3)
    expect(p.puedeLlamar()).toBe(true)
    for (let i = 0; i < 3; i++) p.sumar('orquestador', { input: 1 })
    expect(p.puedeLlamar()).toBe(false)
    expect(p.llamadas()).toBe(3)
  })

  it('el techo por defecto es el declarado', () => {
    const p = crearPresupuesto()
    for (let i = 0; i < MAX_LLAMADAS_TURNO - 1; i++) p.sumar('orquestador', { input: 1 })
    expect(p.puedeLlamar()).toBe(true)
    p.sumar('orquestador', { input: 1 })
    expect(p.puedeLlamar()).toBe(false)
  })
})

describe('el semáforo', () => {
  it('no deja pasar más de los permitidos a la vez', async () => {
    // Sin relojes: cada tarea se cuelga hasta que la prueba la suelta. Una
    // prueba de concurrencia con esperas reales falla sola cuando la máquina
    // está ocupada.
    const conCupo = crearSemaforo(2)
    const puertas = [diferido(), diferido(), diferido(), diferido()]
    let ahora = 0
    let max = 0

    const tareas = puertas.map((puerta) =>
      conCupo(async () => {
        ahora++
        max = Math.max(max, ahora)
        await puerta.promesa
        ahora--
      }),
    )

    // Con cupo 2, sólo dos arrancaron aunque hay cuatro esperando.
    await Promise.resolve()
    expect(max).toBe(2)

    puertas.forEach((p) => p.soltar())
    await Promise.all(tareas)
    expect(max).toBe(2)
  })

  it('libera el cupo aunque la tarea falle', async () => {
    // Si una tarea que explota no devuelve su cupo, el turno se cuelga para
    // siempre esperando un lugar que nunca se libera.
    const conCupo = crearSemaforo(1)
    await expect(
      conCupo(async () => {
        throw new Error('se rompió')
      }),
    ).rejects.toThrow('se rompió')

    await expect(conCupo(async () => 'sigue andando')).resolves.toBe('sigue andando')
  })

  it('respeta el orden de llegada', async () => {
    const conCupo = crearSemaforo(1)
    const orden: number[] = []
    const primera = diferido()

    const a = conCupo(async () => {
      orden.push(1)
      await primera.promesa
    })
    const b = conCupo(async () => {
      orden.push(2)
    })
    const c = conCupo(async () => {
      orden.push(3)
    })

    primera.soltar()
    await Promise.all([a, b, c])
    expect(orden).toEqual([1, 2, 3])
  })
})
