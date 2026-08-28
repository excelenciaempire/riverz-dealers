import { describe, expect, it } from 'vitest'
import { mereceRespuesta } from './merece-respuesta'
import { recortar } from './realtime'

describe('mereceRespuesta', () => {
  it('atiende las críticas que quedaron sin respuesta el 2026-08-28', () => {
    // Los seis comentarios reales de ese día bajo el mismo post. Ninguno
    // quiere comprar, así que el filtro "solo compradores" los descartaba.
    expect(
      mereceRespuesta(
        'Muchos posteos con IA . No confío. Historias defenestrando otros productos. Podrán mostrar aprobación de ANMAT? GRACIAS',
      ),
    ).toBe('duda')
    expect(mereceRespuesta('Qué manera de hacer publicidades falsas mezclando rostros….')).toBe('duda')
    expect(mereceRespuesta('Se van a comer algunos juicios por hablar mal de otras marcas!!!')).toBe('duda')
  })

  it('reconoce un reclamo de post-venta', () => {
    expect(mereceRespuesta('compré hace tres semanas y no me llegó nada')).toBe('reclamo')
    expect(mereceRespuesta('quiero la devolución, nadie contesta')).toBe('reclamo')
  })

  it('reconoce una pregunta concreta', () => {
    expect(mereceRespuesta('¿sirve para piel sensible?')).toBe('pregunta')
    expect(mereceRespuesta('Donde lo consigo en venezuela?')).toBe('pregunta')
  })

  it('deja pasar el halago y la hostilidad sin contenido', () => {
    // Contestar "basta" no ayuda a nadie y sube el hilo a la vista de todos.
    expect(mereceRespuesta('Dejen de mentir, bastaaaa')).toBeNull()
    expect(mereceRespuesta('me encanta 😍')).toBeNull()
    expect(mereceRespuesta('yo')).toBeNull()
    // "que lindo" empieza como pregunta pero no pregunta nada.
    expect(mereceRespuesta('que lindo el producto')).toBeNull()
  })
})

describe('recortar', () => {
  it('no parte una palabra por la mitad', () => {
    // Lo que se publicó de verdad: "…que qui…" debajo de la foto.
    const salida = recortar('¿Hay algo del serum que quieras saber o te interesa probarlo?', 40)
    expect(salida.endsWith('…')).toBe(true)
    expect(salida).not.toContain('qui…')
    expect(salida.replace('…', '').trim().split(' ').pop()).not.toBe('qui')
  })

  it('prefiere terminar en una frase completa', () => {
    expect(recortar('Sí, sirve para el cuello. También para el escote y el rostro.', 30)).toBe(
      'Sí, sirve para el cuello.',
    )
  })

  it('deja intacto lo que ya entra', () => {
    expect(recortar('Sí, sirve.', 120)).toBe('Sí, sirve.')
  })
})
