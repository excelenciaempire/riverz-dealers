import { describe, expect, it } from 'vitest'
import { itemDelAsunto, puedeAportarContexto } from './de-que-habla'

describe('itemDelAsunto', () => {
  it('saca el id de la publicación del asunto que dejó el poll', () => {
    expect(itemDelAsunto('Pregunta · MLA1234567')).toBe('MLA1234567')
    expect(itemDelAsunto('MLM987654321')).toBe('MLM987654321')
  })

  it('no inventa un id cuando no lo hay', () => {
    // Sin esto se pediría a Mercado Libre una publicación que no existe en
    // cada pregunta cuyo asunto sea el título del producto.
    expect(itemDelAsunto('Opinión sobre el serum')).toBeNull()
    expect(itemDelAsunto(null)).toBeNull()
    expect(itemDelAsunto('')).toBeNull()
  })
})

describe('puedeAportarContexto', () => {
  it('sólo pregunta en los canales donde hay algo que traer', () => {
    // Los comentarios NO entran: su contexto lo resuelve publicacion.ts, y
    // preguntar dos veces sería una consulta de más en cada respuesta.
    expect(puedeAportarContexto('ig_comment')).toBe(false)
    expect(puedeAportarContexto('tiktok_comment')).toBe(false)
    expect(puedeAportarContexto('webchat')).toBe(false)

    expect(puedeAportarContexto('mercadolibre')).toBe(true)
    expect(puedeAportarContexto('whatsapp')).toBe(true)
    expect(puedeAportarContexto('instagram')).toBe(true)
    expect(puedeAportarContexto('messenger')).toBe(true)
  })
})
