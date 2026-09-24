import { describe, expect, it } from 'vitest'
import { signUpgradeQuote, verifyUpgradeQuote } from './upgrade-quote'

const secret = 'test-secret'
const context = { workspaceId: 'workspace-1', subscriptionId: 'sub_1', planId: 'plan-2' }
const quote = { ...context, amountCents: 30000, prorationDate: 1_000, monthlyCents: 99900, currency: 'usd' }

describe('cotización de ampliación', () => {
  it('acepta sólo el importe firmado para la cuenta, plan y suscripción correctos', () => {
    const token = signUpgradeQuote(quote, secret)
    expect(verifyUpgradeQuote(token, context, secret, 1_200)).toEqual(quote)
    expect(verifyUpgradeQuote(token, { ...context, planId: 'plan-3' }, secret, 1_200)).toBeNull()
    expect(verifyUpgradeQuote(token, { ...context, workspaceId: 'otra' }, secret, 1_200)).toBeNull()
    expect(verifyUpgradeQuote(token, context, 'another-secret', 1_200)).toBeNull()
  })

  it('rechaza cambios y cotizaciones vencidas', () => {
    const token = signUpgradeQuote(quote, secret)
    expect(verifyUpgradeQuote(`${token}x`, context, secret, 1_200)).toBeNull()
    expect(verifyUpgradeQuote(token, context, secret, 1_601)).toBeNull()
    expect(verifyUpgradeQuote(token, context, secret, 999)).toBeNull()
  })
})
