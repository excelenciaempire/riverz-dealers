import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifySessionToken } from './session-token'

const API_KEY = 'test-api-key'
const SECRET = 'test-secret'
const SHOP = 'mystore.myshopify.com'

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function mint(
  payload: Record<string, unknown>,
  opts: { secret?: string; alg?: string } = {},
): string {
  const header = b64url({ alg: opts.alg ?? 'HS256', typ: 'JWT' })
  const body = b64url(payload)
  const sig = createHmac('sha256', opts.secret ?? SECRET)
    .update(`${header}.${body}`, 'utf8')
    .digest('base64url')
  return `${header}.${body}.${sig}`
}

function validPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: '12345',
    exp: now + 60,
    nbf: now - 10,
    ...overrides,
  }
}

const args = { apiKey: API_KEY, apiSecret: SECRET }

describe('verifySessionToken', () => {
  it('accepts a valid token and returns the shop', () => {
    const result = verifySessionToken(mint(validPayload()), args)
    expect(result).toEqual({ shop: SHOP, sub: '12345' })
  })

  it('rejects a token signed with another secret', () => {
    const token = mint(validPayload(), { secret: 'wrong' })
    expect(verifySessionToken(token, args)).toBeNull()
  })

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000)
    const token = mint(validPayload({ exp: now - 120 }))
    expect(verifySessionToken(token, args)).toBeNull()
  })

  it('rejects a token for another app (aud mismatch)', () => {
    const token = mint(validPayload({ aud: 'other-app' }))
    expect(verifySessionToken(token, args)).toBeNull()
  })

  it('rejects a dest outside myshopify.com', () => {
    const token = mint(
      validPayload({ dest: 'https://evil.example.com', iss: 'https://evil.example.com/admin' }),
    )
    expect(verifySessionToken(token, args)).toBeNull()
  })

  it('rejects an iss that does not live under dest', () => {
    const token = mint(validPayload({ iss: 'https://other.myshopify.com/admin' }))
    expect(verifySessionToken(token, args)).toBeNull()
  })

  it('rejects alg none / tampered header', () => {
    const token = mint(validPayload(), { alg: 'none' })
    expect(verifySessionToken(token, args)).toBeNull()
  })

  it('rejects garbage', () => {
    expect(verifySessionToken('not-a-jwt', args)).toBeNull()
    expect(verifySessionToken('a.b.c', args)).toBeNull()
  })
})
