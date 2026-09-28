import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validPaymentSignature } from './webhook-signature'

const secret = 'test-app-secret'
function signed(id = '123456', signedId = id.toLowerCase()) {
  const hash = createHmac('sha256', secret)
    .update(`id:${signedId};request-id:test-request;ts:1704908010;`).digest('hex')
  return new Request(`https://riverz.co/api/mercadopago/webhook?data.id=${id}`, {
    method: 'POST',
    headers: { 'x-request-id': 'test-request', 'x-signature': `ts=1704908010,v1=${hash}` },
    body: JSON.stringify({ type: 'payment', user_id: 9, data: { id } }),
  })
}

describe('Mercado Pago app webhook authenticity', () => {
  it('accepts the documented HMAC manifest and normalizes alphanumeric ids', () => {
    expect(validPaymentSignature(signed(), secret)).toBe(true)
    expect(validPaymentSignature(signed('ABC123'), secret)).toBe(true)
  })
  it('rejects a different app secret and a substituted payment id', () => {
    expect(validPaymentSignature(signed(), 'other-app-secret')).toBe(false)
    expect(validPaymentSignature(signed('999999', '123456'), secret)).toBe(false)
  })
  it('rejects unsigned notifications and missing configuration', () => {
    expect(validPaymentSignature(new Request('https://riverz.co/api/mercadopago/webhook'), secret)).toBe(false)
    expect(validPaymentSignature(signed(), '')).toBe(false)
  })
  it('rejects missing signed fields, malformed hashes and duplicate signature fields', () => {
    const request = signed()
    request.headers.delete('x-request-id')
    expect(validPaymentSignature(request, secret)).toBe(false)
    const malformed = signed()
    malformed.headers.set('x-signature', 'ts=1704908010,v1=xx')
    expect(validPaymentSignature(malformed, secret)).toBe(false)
    const duplicate = signed()
    duplicate.headers.append('x-signature', 'ts=1704908010')
    expect(validPaymentSignature(duplicate, secret)).toBe(false)
  })
})
