import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BALANCE_PLAN_MONTHLY, PRICING_TIERS } from '@/components/landing/v4/pricing-tiers'

const db = vi.hoisted(() => ({
  result: { data: null as unknown[] | null, error: null as unknown },
}))
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ in: async () => db.result }) }),
  }),
}))

import { publicPricing } from './public-pricing'

const plan = (slug: string, precio_centavos: number, incluidas: number) =>
  ({ slug, activo: true, precio_centavos, incluidas, moneda: 'usd' })

const PLANS = [
  plan('contactos-500', 39900, 500),
  plan('contactos-2000', 99900, 2000),
  plan('contactos-5000', 199900, 5000),
  plan('contactos-10000', 349900, 10000),
  plan('saldo-ilimitado', 44900, 0),
]

describe('publicPricing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reads the balance plan from the same plans Checkout uses', async () => {
    db.result = { data: PLANS, error: null }
    const pricing = await publicPricing()
    expect(pricing.balanceMonthly).toBe(449)
    expect(pricing.tiers).toEqual([
      { customers: 500, monthly: 399 },
      { customers: 2000, monthly: 999 },
      { customers: 5000, monthly: 1999 },
      { customers: 10000, monthly: 3499 },
      { customers: null, monthly: null },
    ])
  })

  it('keeps the contact plans when the balance plan is inactive', async () => {
    db.result = {
      data: PLANS.map((p) => (p.slug === 'saldo-ilimitado' ? { ...p, activo: false } : p)),
      error: null,
    }
    const pricing = await publicPricing()
    expect(pricing.balanceMonthly).toBe(BALANCE_PLAN_MONTHLY)
    expect(pricing.tiers[1]).toEqual({ customers: 2000, monthly: 999 })
    expect(console.error).toHaveBeenCalledWith('[billing/public-pricing] falta el plan con saldo activo')
  })

  it('falls back to the published prices when the plans cannot be read', async () => {
    db.result = { data: null, error: new Error('down') }
    expect(await publicPricing()).toEqual({
      tiers: PRICING_TIERS,
      balanceMonthly: BALANCE_PLAN_MONTHLY,
    })
  })
})
