import { describe, expect, it } from 'vitest'

import { mapaComoTexto, type MapaCuenta } from './account-map'

/**
 * El mapa que el equipo lee antes de tocar nada.
 *
 * Lo que se prueba es el presupuesto. Un mapa que crece con la cuenta funciona
 * en la cuenta de prueba y revienta en la del comercio grande, que es
 * exactamente el que más lo necesita — y no revienta con un error: revienta
 * empujando fuera del contexto las instrucciones, así que el equipo empieza a
 * hacer cualquier cosa sin que nadie entienda por qué.
 */

const base: MapaCuenta = {
  dominios: [
    { id: 'automatizaciones', hay: 6, activos: 4 },
    { id: 'plantillas', hay: 18 },
  ],
  problemas: [],
  canales: [{ canal: 'whatsapp', estado: 'connected' }],
  nombres: {
    plantillas: ['carrito_v1'],
    etiquetas: ['comprador'],
    segmentos: [],
    automatizaciones: ['Carrito abandonado'],
    agentes: [],
  },
  generadoEn: '2026-08-20T00:00:00.000Z',
}

const muchos = (n: number, pre: string) =>
  Array.from({ length: n }, (_, i) => `${pre}_${i}`)

describe('el mapa como lo lee el modelo', () => {
  it('entra en el presupuesto aunque la cuenta sea enorme', () => {
    // 4.800 caracteres es el proxy de los 1.200 tokens que tiene asignados.
    // Sin tope, una cuenta con 500 etiquetas se come el prompt entero.
    const grande: MapaCuenta = {
      ...base,
      nombres: {
        plantillas: muchos(200, 'plantilla'),
        etiquetas: muchos(500, 'etiqueta'),
        segmentos: muchos(80, 'segmento'),
        automatizaciones: muchos(120, 'auto'),
        agentes: muchos(40, 'agente'),
      },
    }
    const texto = mapaComoTexto(grande)
    expect(texto.length).toBeLessThan(4800)
  })

  it('avisa cuántos quedaron afuera en vez de cortar en silencio', () => {
    // Si el equipo no sabe que la lista está recortada, va a asumir que no
    // existe lo que no ve y crear un duplicado.
    const texto = mapaComoTexto({
      ...base,
      nombres: { ...base.nombres, etiquetas: muchos(60, 'etiqueta') },
    })
    expect(texto).toMatch(/\+20 más/)
  })

  it('no recorta cuando no hace falta', () => {
    const texto = mapaComoTexto(base)
    expect(texto).not.toMatch(/más/)
    expect(texto).toContain('carrito_v1')
  })

  it('dice qué hay y cuánto está prendido', () => {
    const texto = mapaComoTexto(base)
    expect(texto).toContain('automatizaciones: 6 (4 activas)')
    // Sin `activos` no inventa un paréntesis vacío.
    expect(texto).toContain('plantillas: 18\n')
  })

  it('separa los canales conectados de los que están rotos', () => {
    // "Tengo Instagram" y "tengo Instagram caído" llevan a respuestas
    // opuestas, y el segundo caso es el que hay que decir en voz alta.
    const texto = mapaComoTexto({
      ...base,
      canales: [
        { canal: 'whatsapp', estado: 'connected' },
        { canal: 'instagram', estado: 'error' },
      ],
    })
    expect(texto).toContain('Canales conectados: whatsapp')
    expect(texto).toContain('instagram (error)')
  })

  it('sin canales lo dice, en vez de dejar la línea vacía', () => {
    const texto = mapaComoTexto({ ...base, canales: [] })
    expect(texto).toContain('Canales conectados: ninguno')
  })

  it('los problemas van con su gravedad', () => {
    const texto = mapaComoTexto({
      ...base,
      problemas: [
        {
          kind: 'template_rejected',
          severity: 'critical',
          count: 2,
          detail: '2 plantillas rechazadas',
          href: '/plantillas',
          audience: 'comercio',
          lastAt: null,
          refId: '',
        },
      ],
    })
    expect(texto).toContain('NECESITA ATENCIÓN')
    expect(texto).toContain('[critical] 2 plantillas rechazadas')
  })

  it('aclara que es un inventario, no un estado', () => {
    // Sin esta línea el equipo lee "plantillas: 18" y contesta preguntas sobre
    // cómo vienen las plantillas sin haber mirado ninguna.
    expect(mapaComoTexto(base)).toContain('sólo qué existe')
  })
})
