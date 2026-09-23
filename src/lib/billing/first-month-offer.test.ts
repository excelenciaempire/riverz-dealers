import { describe, expect, it } from 'vitest'
import { eligibleForFirstMonthOffer, firstMonthCents } from './first-month-offer'

describe('first month offer', () => {
  it('discounts the first invoice and keeps the monthly base intact', () => {
    expect(firstMonthCents(39900)).toBe(25935)
    expect(firstMonthCents(99900)).toBe(64935)
    expect(firstMonthCents(199900)).toBe(129935)
    expect(firstMonthCents(349900)).toBe(227435)
  })

  it('does not apply to legacy balances or an existing subscription', () => {
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'oficial', stripeSubscriptionId: null, precioAcuerdoCentavos: 39900 })).toBe(true)
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'saldo', stripeSubscriptionId: null, precioAcuerdoCentavos: 39900 })).toBe(false)
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'oficial', stripeSubscriptionId: 'sub_old', precioAcuerdoCentavos: 39900 })).toBe(false)
  })
})
