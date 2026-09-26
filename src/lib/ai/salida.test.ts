import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { largoDeChat, recortarSalida, salidaParaCliente } from './salida'

/**
 * El 2026-08-28 se publicó debajo de una foto de Instagram "El serum vale
 * **$39.990**", con los asteriscos. El limpiador existía y funcionaba desde
 * antes; lo que falló fue que llamarlo era decisión de cada superficie, y la
 * superficie nueva no lo llamó. Nadie se enteró hasta leer lo que se publicó.
 *
 * Por eso este archivo tiene dos mitades. La primera prueba la función. La
 * segunda vigila que los COMPOSITORES la usen: si mañana alguien agrega otro
 * y se olvida, se rompe un test en vez de romperse un comentario público.
 */
describe('salidaParaCliente', () => {
  it('saca los tics de la máquina', () => {
    expect(salidaParaCliente('El serum vale **$39.990** por 1 unidad.')).toBe(
      'El serum vale $39.990 por 1 unidad.',
    )
  })

  it('devuelve null cuando no hay nada que mandar', () => {
    // Ese día se guardaron mensajes automáticos VACÍOS en webchat, WhatsApp e
    // Instagram: el modelo devolvió nada y se envió igual. Con null, el
    // llamador tiene que decidir qué hacer sin texto.
    expect(salidaParaCliente('')).toBeNull()
    expect(salidaParaCliente('   ')).toBeNull()
    expect(salidaParaCliente(null)).toBeNull()
    expect(salidaParaCliente('...')).toBeNull()
    expect(salidaParaCliente('"')).toBeNull()
  })

  it('no se come un mensaje que sí dice algo', () => {
    expect(salidaParaCliente('Sí, sirve para el cuello.')).toBe('Sí, sirve para el cuello.')
    expect(salidaParaCliente('  Hola 👋  ')).toBe('Hola 👋')
  })
})

describe('recortarSalida', () => {
  it('no parte una palabra por la mitad', () => {
    // Lo que se publicó de verdad: "…que qui…".
    const salida = recortarSalida('¿Hay algo del serum que quieras saber o te interesa probarlo?', 40)
    expect(salida).not.toContain('qui…')
  })

  it('prefiere terminar en una frase completa', () => {
    expect(recortarSalida('Sí, sirve para el cuello. También para el escote.', 30)).toBe(
      'Sí, sirve para el cuello.',
    )
  })
})

describe('largoDeChat', () => {
  // Lo que llegó a un cliente el 2026-09-26: cortado en 450 caracteres a secas.
  const largo =
    'Es un tratamiento que pide constancia: la primera semana se prepara el cuero cabelludo, desde la semana 8 empiezan a aparecer los primeros pelitos y hacia el mes 4 se ve el cambio. '.repeat(3)

  it('no corta un mensaje que se pasó un poco de lo pedido', () => {
    expect(largo.trim().length).toBeGreaterThan(450)
    expect(largoDeChat(largo, 450)).toBe(largo.trim())
  })

  it('a uno desbocado lo recorta en una frase completa, sin puntos suspensivos', () => {
    const salida = largoDeChat(largo.repeat(3), 450)
    expect(salida.length).toBeLessThanOrEqual(900)
    expect(salida.endsWith('cambio.')).toBe(true)
  })
})

/**
 * Los compositores: todo lo que convierte una respuesta de un modelo en algo
 * que lee una persona. Si agregás uno, hacelo pasar por `salidaParaCliente` y
 * sumalo acá.
 */
const COMPOSITORES = [
  'src/lib/ai/super-agent.ts',
  'src/lib/instagram-agent/realtime.ts',
]

describe('nadie manda texto de un modelo sin pasar por la puerta', () => {
  for (const archivo of COMPOSITORES) {
    it(`${archivo} usa salidaParaCliente`, () => {
      const fuente = readFileSync(join(process.cwd(), archivo), 'utf8')
      expect(
        fuente.includes('salidaParaCliente'),
        `${archivo} arma un texto para una persona y no lo pasa por salidaParaCliente(). ` +
          'Así se publicó "**$39.990**" con los asteriscos debajo de una foto.',
      ).toBe(true)
    })
  }
})
