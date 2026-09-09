import { describe, expect, it } from 'vitest'
import { operatorErrorMessage } from './error-message'

describe('operator billing errors', () => {
  it('explains insufficient balance in both languages', () => {
    expect(operatorErrorMessage('es', new Error('sin_saldo'))).toContain('Recarga')
    expect(operatorErrorMessage('en', 'sin_saldo')).toContain('Top up')
  })
  it('distinguishes subscription expiration and hides internal errors', () => {
    expect(operatorErrorMessage('en', 'suscripcion_vencida')).toContain('subscription')
    expect(operatorErrorMessage('en', new Error('secret provider response'))).not.toContain('secret')
  })
})
