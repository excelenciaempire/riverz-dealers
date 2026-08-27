import { describe, it, expect } from 'vitest'
import {
  BLOQUES,
  bloquesVisibles,
  faltantes,
  normalizarPliego,
  pliegoATexto,
  pliegoPorDefecto,
  type ContextoPliego,
} from './pliego'

const TODO: ContextoPliego = {
  tienda: true,
  whatsapp: true,
  meta: true,
  mercadolibre: true,
  email: true,
  telefono: true,
}

const PELADO: ContextoPliego = {
  tienda: false,
  whatsapp: false,
  meta: false,
  mercadolibre: false,
  email: false,
  telefono: false,
}

describe('normalizarPliego', () => {
  it('descarta ids que no existen', () => {
    expect(normalizarPliego({ inventado: 'si' })).toEqual({})
  })

  it('descarta opciones que no están en la lista', () => {
    // El día que alguien mande `t_reembolsar: "auto_siempre"` desde la consola
    // del navegador, la respuesta no puede entrar sólo porque llegó.
    expect(normalizarPliego({ t_reembolsar: 'auto_siempre' })).toEqual({})
    expect(normalizarPliego({ t_reembolsar: 'auto' })).toEqual({
      t_reembolsar: 'auto',
    })
  })

  it('recorta el descuento a su tope', () => {
    expect(normalizarPliego({ descuento: 900 })).toEqual({ descuento: 60 })
    expect(normalizarPliego({ descuento: -5 })).toEqual({ descuento: 0 })
  })

  it('filtra los valores sueltos de una multi', () => {
    expect(normalizarPliego({ excluir: ['reciente', 'inventado'] })).toEqual({
      excluir: ['reciente'],
    })
  })

  it('exige horas con formato de reloj', () => {
    expect(normalizarPliego({ horario: { desde: '25:00', hasta: '18:00' } })).toEqual({})
    expect(normalizarPliego({ horario: { desde: '09:00', hasta: '18:00' } })).toEqual({
      horario: { desde: '09:00', hasta: '18:00' },
    })
  })
})

describe('los valores por defecto', () => {
  it('dejan apagado todo lo que toca dinero', () => {
    const d = pliegoPorDefecto()
    expect(d.t_cancelar).toBe('off')
    expect(d.t_reembolsar).toBe('off')
    expect(d.descuento).toBe(0)
    expect(d.prospeccion).toBe('no')
    expect(d.voz_entrante).toBe('no')
  })

  it('cubren todas las preguntas', () => {
    const ids = BLOQUES.flatMap((b) => b.preguntas.map((p) => p.id))
    const d = pliegoPorDefecto()
    for (const id of ids) expect(d[id]).toBeDefined()
  })

  it('no repiten un id entre bloques', () => {
    const ids = BLOQUES.flatMap((b) => b.preguntas.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('bloquesVisibles', () => {
  it('esconde lo que la cuenta no tiene conectado', () => {
    const visibles = bloquesVisibles(PELADO, {}).map((b) => b.id)
    expect(visibles).not.toContain('venta')
    expect(visibles).not.toContain('pedidos')
    expect(visibles).not.toContain('comentarios')
    // Estos no dependen de ninguna conexión: son la marca y su gente.
    expect(visibles).toContain('voz')
    expect(visibles).toContain('equipo')
  })

  it('abre la pregunta por las zonas recién cuando hay contraentrega', () => {
    const sin = bloquesVisibles(TODO, { contraentrega: 'no' })
      .find((b) => b.id === 'venta')!
      .preguntas.map((p) => p.id)
    expect(sin).not.toContain('zonas')

    const con = bloquesVisibles(TODO, { contraentrega: 'si' })
      .find((b) => b.id === 'venta')!
      .preguntas.map((p) => p.id)
    expect(con).toContain('zonas')
  })

  it('no pregunta cuándo ofrecer descuento si el tope es cero', () => {
    const ids = bloquesVisibles(TODO, { descuento: 0 })
      .find((b) => b.id === 'venta')!
      .preguntas.map((p) => p.id)
    expect(ids).not.toContain('descuento_cuando')
  })
})

describe('faltantes', () => {
  it('no cuenta lo que ni siquiera se muestra', () => {
    // Una cuenta sin nada conectado tiene que poder terminar el pliego. Si las
    // preguntas escondidas contaran, siempre le debería algo a la pantalla.
    const pelado = faltantes(PELADO, {})
    const todo = faltantes(TODO, {})
    expect(pelado).toBeLessThan(todo)
  })

  it('baja a cero cuando se contesta todo lo visible', () => {
    const visibles = bloquesVisibles(PELADO, {}).flatMap((b) => b.preguntas)
    const r = Object.fromEntries(visibles.map((p) => [p.id, p.porDefecto]))
    expect(faltantes(PELADO, r)).toBe(0)
  })
})

describe('pliegoATexto', () => {
  it('marca lo que nadie contestó', () => {
    const texto = pliegoATexto(TODO, { descuento: 15 }, 'es')
    expect(texto).toContain('[ai_agents.discount_cap]')
    expect(texto).toContain('15')
    // El resto sigue siendo el mínimo seguro, y el Operador tiene que saber
    // que nadie lo eligió.
    expect(texto).toContain('(por defecto)')
  })

  it('sale en el idioma del comercio', () => {
    expect(pliegoATexto(PELADO, { emojis: 'si' }, 'en')).toContain('Does it use emoji?')
    expect(pliegoATexto(PELADO, { emojis: 'si' }, 'es')).toContain('¿Usa emojis?')
  })
})
