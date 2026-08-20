import { describe, expect, it } from 'vitest'

import { validarPlan } from './plan'

/**
 * El reparto, antes de que corra nada.
 *
 * Todo lo que se valida acá se valida ANTES de guardar, y eso importa: un plan
 * mal formado que se guarda es un plan que alguien va a aprobar sin poder
 * ejecutarse, y el error va a aparecer después del click, cuando ya parece que
 * el sistema falló en vez de que el pedido estaba mal escrito.
 *
 * Los errores vuelven en castellano y no como excepción porque el modelo puede
 * corregir y volver a intentar en la misma vuelta.
 */

const paso = (subagente: string, encargo = 'hacé la cosa', depende_de?: number[]) => ({
  subagente,
  encargo,
  ...(depende_de ? { depende_de } : {}),
})

describe('un plan válido', () => {
  it('el caso del carrito abandonado son dos olas de a uno', () => {
    const r = validarPlan({
      porque: 'la automatización necesita la plantilla',
      pasos: [
        paso('plantillas', 'Escribí la plantilla de carrito'),
        paso('automatizaciones', 'Armá el rescate', [0]),
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.olas).toEqual([[0], [1]])
    expect(r.plan.pasos[1].dependeDe).toEqual([0])
  })

  it('lo que no se debe nada va junto', () => {
    const r = validarPlan({
      pasos: [paso('plantillas'), paso('contactos'), paso('voz')],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.olas).toEqual([[0, 1, 2]])
  })

  it('recorta los espacios del encargo', () => {
    const r = validarPlan({ pasos: [paso('voz', '   llamá a Ana   ')] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.pasos[0].encargo).toBe('llamá a Ana')
  })
})

describe('lo que se rechaza, y con qué mensaje', () => {
  it('un plan sin pasos', () => {
    const r = validarPlan({ pasos: [] })
    expect(r).toEqual({ ok: false, error: 'El plan no tiene pasos.' })
  })

  it('un subagente que no está en el equipo', () => {
    // El modelo elige el destinatario, así que puede inventar uno.
    const r = validarPlan({ pasos: [paso('marketing')] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('marketing')
    expect(r.error).toContain('equipo')
  })

  it('un paso que no dice qué hacer', () => {
    const r = validarPlan({ pasos: [paso('voz', '   ')] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('no dice qué hay que hacer')
  })

  it('una dependencia a un paso que no existe', () => {
    const r = validarPlan({ pasos: [paso('voz', 'x', [5])] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('no existe')
  })

  it('un paso que se depende de sí mismo', () => {
    const r = validarPlan({ pasos: [paso('voz', 'x', [0])] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('sí mismo')
  })

  it('un ciclo, con los pasos nombrados', () => {
    // "Los pasos 0 y 1 se esperan entre sí" se puede leer y corregir; una
    // excepción, no.
    const r = validarPlan({
      pasos: [paso('plantillas', 'x', [1]), paso('automatizaciones', 'y', [0])],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('se esperan entre sí')
    expect(r.error).toMatch(/0 y 1/)
  })

  it('un plan gigante, con la sugerencia de juntar', () => {
    const r = validarPlan({ pasos: Array.from({ length: 13 }, () => paso('voz')) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('máximo')
    // El mensaje sugiere qué hacer, no sólo que está mal: un error que no dice
    // cómo salir deja al modelo reintentando lo mismo.
    expect(r.error.toLowerCase()).toContain('junta')
  })

  it('un encargo interminable', () => {
    const r = validarPlan({ pasos: [paso('voz', 'x'.repeat(700))] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('larguísimo')
  })

  it('una entrada que no es un plan', () => {
    expect(validarPlan(null).ok).toBe(false)
    expect(validarPlan({}).ok).toBe(false)
    expect(validarPlan({ pasos: 'dos' }).ok).toBe(false)
  })
})
