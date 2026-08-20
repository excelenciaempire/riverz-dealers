import { describe, expect, it } from 'vitest'
import { claveRechazada } from './platform-key'

/**
 * Distinguir "esta clave no sirve" de "el modelo falló" es lo que decide si
 * reintentar con otra clave o rendirse. Los casos de acá son errores reales
 * copiados de `ai_replies` en producción.
 */
describe('claveRechazada', () => {
  it('reconoce la clave revocada (401)', () => {
    expect(
      claveRechazada({
        status: 401,
        message:
          '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      }),
    ).toBe(true)
  })

  it('reconoce el saldo agotado, que llega como 400 y no como 402', () => {
    // El caso que dejó a un comercio dos semanas sin respuestas automáticas:
    // mirando sólo el código HTTP es indistinguible de un pedido mal armado.
    expect(
      claveRechazada({
        status: 400,
        message:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}}',
      }),
    ).toBe(true)
  })

  it('no reintenta cuando el modelo está saturado', () => {
    expect(claveRechazada({ status: 429, message: '429 rate_limit_error' })).toBe(
      false,
    )
    expect(claveRechazada({ status: 529, message: '529 overloaded_error' })).toBe(
      false,
    )
  })

  it('no reintenta ante un 400 que sí es culpa del pedido', () => {
    expect(
      claveRechazada({
        status: 400,
        message:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be greater than 0"}}',
      }),
    ).toBe(false)
  })

  it('aguanta lo que no es un error del SDK', () => {
    expect(claveRechazada(null)).toBe(false)
    expect(claveRechazada('boom')).toBe(false)
    expect(claveRechazada(new Error('socket hang up'))).toBe(false)
  })
})
