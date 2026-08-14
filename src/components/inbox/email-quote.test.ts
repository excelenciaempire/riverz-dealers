import { describe, it, expect } from 'vitest'
import { splitEmailQuote } from './message-bubble'

describe('splitEmailQuote', () => {
  it('separa la cita de Apple Mail SIN día de la semana', () => {
    // El caso real que dejaba el mensaje enterrado: iOS cita con el día
    // numérico, sin "lunes"/"martes" delante.
    const raw = [
      'Estimados. Todavía no llegó. Espero respuesta. Gracias!!',
      '',
      'El 13 ago 2026, a la(s) 12:58 a. m., Mi tienda <store+7797@t.shopifyemail.com> escribió:',
      '',
      'Tu pedido va en camino…',
    ].join('\n')
    const { primary, quoted } = splitEmailQuote(raw)
    expect(primary).toBe('Estimados. Todavía no llegó. Espero respuesta. Gracias!!')
    expect(quoted).toContain('escribió:')
  })

  it('sigue separando la cita CON día de la semana', () => {
    const raw = 'Gracias!\n\nEl lunes 4 ago 2026, Juan <j@x.com> escribió:\n> hola'
    expect(splitEmailQuote(raw).primary).toBe('Gracias!')
  })

  it('separa las variantes en inglés', () => {
    const dayFirst = 'Thanks!\n\nOn 13 Aug 2026 at 00:58, Store <s@x.com> wrote:\n> hi'
    expect(splitEmailQuote(dayFirst).primary).toBe('Thanks!')
    const monthFirst = 'Thanks!\n\nOn Aug 13, 2026, at 12:58 AM, Store <s@x.com> wrote:\n> hi'
    expect(splitEmailQuote(monthFirst).primary).toBe('Thanks!')
  })

  it('un correo sin cita queda entero', () => {
    const raw = 'Hola, quería consultar por el pedido 1234. Gracias.'
    const { primary, quoted } = splitEmailQuote(raw)
    expect(primary).toBe(raw)
    expect(quoted).toBe('')
  })

  it('una fecha suelta en la prosa no se confunde con una cita', () => {
    // Sin "escribió:" al final no hay cita, por mucho que haya una fecha.
    const raw = 'El 13 ago 2026 me llegó el pedido y estaba todo bien.'
    expect(splitEmailQuote(raw).quoted).toBe('')
  })

  it('corta en el marcador más temprano cuando hay varios', () => {
    const raw = [
      'Va mi respuesta.',
      'Enviado desde mi iPhone',
      'El 13 ago 2026, a la(s) 12:58 a. m., X <x@y.com> escribió:',
    ].join('\n')
    expect(splitEmailQuote(raw).primary).toBe('Va mi respuesta.')
  })
})
