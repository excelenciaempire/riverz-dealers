import { describe, expect, it } from 'vitest'
import { esRespuestaAutomatica } from './respuesta-automatica'

const reciente = {
  ultimoRemitente: 'bot',
  ultimoMensajeAt: '2026-09-17T15:20:30.000Z',
  recibidoAt: '2026-09-17T15:20:48.000Z',
}

describe('esRespuestaAutomatica', () => {
  it('reconoce el saludo de WhatsApp Business del cliente (caso Rasmiaw)', () => {
    expect(esRespuestaAutomatica({
      texto: 'Gracias por comunicarte con Soluciones Administrativas Contables y Financieras.📈🪙 ¿Cómo podemos ayudarte?',
      ...reciente,
    })).toBe(true)
  })

  it.each([
    'Este es un mensaje automático. En este momento no podemos atenderte.',
    'Thank you for contacting Acme. We will get back to you shortly.',
    'Hola! Estamos fuera de horario, te responderemos a la brevedad.',
    'Nos pondremos en contacto contigo lo antes posible.',
  ])('las fórmulas fuertes valen aunque no haya mensaje nuestro cerca: %s', (texto) => {
    expect(esRespuestaAutomatica({ texto, recibidoAt: reciente.recibidoAt })).toBe(true)
  })

  it('un saludo de negocio sólo cuenta si llega justo después de algo nuestro', () => {
    const texto = '¡Bienvenido a Clínica Dental Sonrisa! ¿En qué podemos ayudarte?'
    expect(esRespuestaAutomatica({ texto, ...reciente })).toBe(true)
    // Media hora después, o después de que habló el propio cliente, es una persona.
    expect(esRespuestaAutomatica({ texto, ...reciente, recibidoAt: '2026-09-17T15:55:00.000Z' })).toBe(false)
    expect(esRespuestaAutomatica({ texto, ...reciente, ultimoRemitente: 'customer' })).toBe(false)
    expect(esRespuestaAutomatica({ texto, recibidoAt: reciente.recibidoAt })).toBe(false)
  })

  it.each([
    'Hola, quiero saber cuándo llega mi pedido',
    'Gracias! Ya me llegó el rascador, está hermoso',
    'Sí, mantener contraentrega',
    'Muchas gracias por la atención, me ayudaron mucho',
    '',
    null,
  ])('lo que escribe una persona pasa: %s', (texto) => {
    expect(esRespuestaAutomatica({ texto, ...reciente })).toBe(false)
  })
})
