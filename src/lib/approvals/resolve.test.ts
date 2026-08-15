import { describe, it, expect } from 'vitest'
import { parseReply } from './resolve'

/**
 * La respuesta del comerciante llega escrita a mano desde el teclado del
 * teléfono. Lo que se acepte de más acá termina marcando pedidos como
 * pagados sin que nadie lo haya querido.
 */
describe('parseReply', () => {
  it('acepta el sí y el no con el código', () => {
    expect(parseReply('SI a1b2c3')).toEqual({ decision: 'aprobada', code: 'a1b2c3' })
    expect(parseReply('NO a1b2c3')).toEqual({ decision: 'rechazada', code: 'a1b2c3' })
  })

  it('no se pelea con la tilde ni con las mayúsculas', () => {
    expect(parseReply('sí A1B2C3')).toEqual({ decision: 'aprobada', code: 'a1b2c3' })
    expect(parseReply('  no   ABCDEF  ')).toEqual({ decision: 'rechazada', code: 'abcdef' })
  })

  it('un "sí" suelto no aprueba nada', () => {
    // Sin código no se sabe QUÉ está aprobando, y la última pregunta puede no
    // ser la que tiene en la cabeza.
    expect(parseReply('si')).toBeNull()
    expect(parseReply('dale')).toBeNull()
    expect(parseReply('sí, marcalo')).toBeNull()
  })

  it('un código que no es un código no pasa', () => {
    expect(parseReply('si 123')).toBeNull()
    expect(parseReply('si zzzzzz')).toBeNull()
    expect(parseReply('si a1b2c3 gracias')).toBeNull()
  })

  it('un mensaje cualquiera no es una decisión', () => {
    expect(parseReply('hola, cómo va?')).toBeNull()
    expect(parseReply('')).toBeNull()
  })
})
