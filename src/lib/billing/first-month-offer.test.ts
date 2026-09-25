import { describe, expect, it } from 'vitest'
import { eligibleForFirstMonthOffer, endOfFreeFirstMonth, firstMonthCents, firstMonthCouponId, firstMonthDiscountCents } from './first-month-offer'

describe('first month offer', () => {
  it('discounts the first invoice and keeps the monthly base intact', () => {
    expect(firstMonthCents(39900)).toBe(25900)
    expect(firstMonthCents(99900)).toBe(64900)
    expect(firstMonthCents(199900)).toBe(129900)
    expect(firstMonthCents(349900)).toBe(227400)
    expect(firstMonthDiscountCents(39900)).toBe(14000)
    expect(firstMonthCouponId(39900, 'USD')).toBe('riverz-first-month-35-usd-39900-v2')
    expect(firstMonthCouponId(99900, 'USD')).not.toBe(firstMonthCouponId(39900, 'USD'))
  })

  it('charges a free first month on the same day next month', () => {
    const next = (iso: string) => endOfFreeFirstMonth(new Date(iso)).toISOString()
    expect(next('2026-09-25T18:30:00.000Z')).toBe('2026-10-25T18:30:00.000Z')
    expect(next('2026-12-15T00:00:00.000Z')).toBe('2027-01-15T00:00:00.000Z')
    expect(next('2026-01-31T12:00:00.000Z')).toBe('2026-02-28T12:00:00.000Z')
    expect(next('2028-01-31T12:00:00.000Z')).toBe('2028-02-29T12:00:00.000Z')
  })

  it('applies to the private unlimited-balance offer but not other legacy balances', () => {
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'oficial', stripeSubscriptionId: null, precioAcuerdoCentavos: 39900 })).toBe(true)
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'saldo', stripeSubscriptionId: null, precioAcuerdoCentavos: 39900 })).toBe(false)
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'saldo', plan: { slug: 'saldo-ilimitado' }, stripeSubscriptionId: null, precioAcuerdoCentavos: 39900 })).toBe(true)
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'oficial', stripeSubscriptionId: 'sub_old', precioAcuerdoCentavos: 39900 })).toBe(false)
    expect(eligibleForFirstMonthOffer({ modeloCobro: 'saldo', plan: { slug: 'saldo-ilimitado' }, stripeSubscriptionId: 'sub_old', precioAcuerdoCentavos: 39900 })).toBe(false)
  })
})
