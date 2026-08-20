import { describe, expect, it } from 'vitest'

import { alcanzadosPor, olas } from './olas'

const p = (i: number, ...dependeDe: number[]) => ({ i, dependeDe })

describe('en qué orden corre el plan', () => {
  it('sin dependencias, todo va junto', () => {
    // Es el caso que justifica devolver olas y no una lista ordenada: tres
    // lecturas independientes no tienen por qué esperarse.
    const r = olas([p(0), p(1), p(2)])
    expect(r).toEqual({ ok: true, olas: [[0, 1, 2]] })
  })

  it('el carrito abandonado son dos olas de a uno', () => {
    // La automatización necesita el nombre de la plantilla que el otro todavía
    // no creó. Es el caso que motiva todo esto.
    const r = olas([p(0), p(1, 0)])
    expect(r).toEqual({ ok: true, olas: [[0], [1]] })
  })

  it('una raíz con dos ramas abre la segunda ola', () => {
    const r = olas([p(0), p(1, 0), p(2, 0)])
    expect(r).toEqual({ ok: true, olas: [[0], [1, 2]] })
  })

  it('quien depende de dos espera a los dos', () => {
    const r = olas([p(0), p(1), p(2, 0, 1)])
    expect(r).toEqual({ ok: true, olas: [[0, 1], [2]] })
  })

  it('un ciclo se devuelve, no se lanza', () => {
    // El orquestador puede escribir mal las dependencias. "Los pasos 0 y 1 se
    // esperan entre sí" se puede decir en castellano; una excepción, no.
    const r = olas([p(0, 1), p(1, 0)])
    expect(r).toEqual({ ok: false, ciclo: [0, 1] })
  })

  it('un paso que se depende de sí mismo no traba el plan', () => {
    const r = olas([p(0, 0), p(1)])
    expect(r).toEqual({ ok: true, olas: [[0, 1]] })
  })

  it('una dependencia a un paso inexistente se ignora', () => {
    // Error de escritura del modelo, no razón para no hacer nada.
    const r = olas([p(0, 99)])
    expect(r).toEqual({ ok: true, olas: [[0]] })
  })

  it('sin pasos, sin olas', () => {
    expect(olas([])).toEqual({ ok: true, olas: [] })
  })
})

describe('qué se cae cuando algo falla', () => {
  it('arrastra a los que dependían, en cadena', () => {
    const pasos = [p(0), p(1, 0), p(2, 1), p(3)]
    expect([...alcanzadosPor(pasos, [0])].sort()).toEqual([1, 2])
  })

  it('no incluye al que falló: se cuenta aparte', () => {
    // "No se pudo" y "ni se intentó" son dos estados distintos en pantalla, y
    // mezclarlos hace creer que se rompieron cinco cosas cuando se rompió una.
    const pasos = [p(0), p(1, 0)]
    expect(alcanzadosPor(pasos, [0]).has(0)).toBe(false)
  })

  it('las ramas que no dependían siguen vivas', () => {
    const pasos = [p(0), p(1), p(2, 0)]
    expect([...alcanzadosPor(pasos, [0])]).toEqual([2])
  })
})
