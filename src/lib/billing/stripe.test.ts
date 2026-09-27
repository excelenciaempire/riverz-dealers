import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Suscripcion } from './plan'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  expireSession: vi.fn(),
  retrieveCoupon: vi.fn(),
  attachAffiliateWorkspace: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: mocks.createSession, list: mocks.listSessions, expire: mocks.expireSession } }
    coupons = { retrieve: mocks.retrieveCoupon }
  },
}))
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => 'es' }))
vi.mock('@/lib/affiliates/program', () => ({ attachAffiliateWorkspace: mocks.attachAffiliateWorkspace }))

import { expirarCheckoutsDelAcuerdo, lineItemsDeSuscripcion, urlDeCheckout } from './stripe'
import { firstMonthCouponId, firstMonthDiscountCents } from './first-month-offer'

const cuenta = (cambio: Partial<Suscripcion> = {}): Suscripcion => ({
  plan: {
    id: 'p1', slug: 'contactos-500', nombre: 'Hasta 500 contactos', activo: true,
    precioCentavos: 39900, moneda: 'usd', incluidas: 500, excedenteCentavos: 0,
    stripePriceId: null, stripePriceExcedenteId: 'price_legacy_metered', orden: 1,
  },
  workspaceId: 'w1', estado: 'activa', pruebaHasta: null, periodoDesde: null,
  periodoHasta: null, vencidaDesde: null, nota: null, stripeCustomerId: null,
  stripeSubscriptionId: null, billingProvider: 'stripe', shopifySubscriptionId: null,
  shopifyShopDomain: null, cancelarAlFinal: false, modeloCobro: 'oficial',
  precioCentavos: 25935, precioAcuerdoCentavos: 25935, incluidas: 500,
  excedenteCentavos: 0, tratoPropio: true, ...cambio,
})
describe('importe de Checkout', () => {
  it('cobra el precio pactado sin ítem medido en Todo incluido', () => {
    const items = lineItemsDeSuscripcion(cuenta(), 'en')
    expect(items).toHaveLength(1)
    expect(items[0].price_data?.unit_amount).toBe(25935)
    expect(items[0].price_data?.product_data?.name).toBe('Riverz · Up to 500 contacts')
  })

  it('permite cobrar el plan aprobado después de instalar gratis', () => {
    const items = lineItemsDeSuscripcion(cuenta({
      estado: 'cortesia', precioCentavos: 0, precioAcuerdoCentavos: 39900,
    }), 'es')
    expect(items[0].price_data?.unit_amount).toBe(39900)
  })

  it('conserva el ítem medido si la cuenta sigue en saldo legado', () => {
    const items = lineItemsDeSuscripcion(cuenta({ modeloCobro: 'saldo' }), 'es')
    expect(items).toHaveLength(2)
    expect(items[1].price).toBe('price_legacy_metered')
  })

  it('nombra la oferta privada y no añade cobro medido si el uso sale del saldo', () => {
    const items = lineItemsDeSuscripcion(cuenta({
      modeloCobro: 'saldo', incluidas: 0,
      plan: { ...cuenta().plan!, slug: 'saldo-ilimitado', nombre: 'Contactos ilimitados con saldo', incluidas: 0 },
    }), 'en')
    expect(items).toHaveLength(1)
    expect(items[0].price_data?.product_data?.name).toBe('Riverz · Unlimited contacts with balance')
  })
})

describe('link de pago', () => {
  const saldo = cuenta({
    modeloCobro: 'saldo', estado: 'cortesia', incluidas: 0, precioCentavos: 0,
    precioAcuerdoCentavos: 39900, tratoPropio: false, stripeCustomerId: 'cus_1',
    plan: {
      ...cuenta().plan!, id: 'p-saldo', slug: 'saldo-ilimitado', nombre: 'Contactos ilimitados con saldo',
      precioCentavos: 39900, incluidas: 0, stripePriceExcedenteId: null, orden: 90,
    },
  })
  const db = {} as SupabaseClient
  const quien = { email: null, nombre: null }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    mocks.createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    mocks.retrieveCoupon.mockResolvedValue({
      id: 'riverz-first-month-35-usd-39900-v2', valid: true, duration: 'once', amount_off: 14000, currency: 'usd',
    })
  })

  it('no cobra el primer mes ya pagado: 30 días de prueba y después la mensualidad completa', async () => {
    const url = await urlDeCheckout(db, 'w1', saldo, quien, { primerMesSinCargo: true })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_1')
    expect(mocks.attachAffiliateWorkspace).toHaveBeenCalledWith(db, 'w1')
    const sesion = mocks.createSession.mock.calls[0][0]
    expect(sesion.subscription_data).toEqual({
      metadata: { workspace_id: 'w1', plan_id: 'p-saldo', modelo_cobro: 'saldo' },
      trial_period_days: 30,
    })
    expect(sesion.discounts).toBeUndefined()
    expect(sesion.payment_method_collection).toBe('always')
    expect(sesion.metadata).toEqual({ workspace_id: 'w1' })
    expect(sesion.client_reference_id).toBe('w1')
    expect(sesion.success_url).toContain('tab=billing')
    expect(mocks.retrieveCoupon).not.toHaveBeenCalled()
    expect(sesion.line_items[0].price_data.unit_amount).toBe(39900)
  })

  it('sin esa opción cobra hoy con la promoción del primer mes', async () => {
    await urlDeCheckout(db, 'w1', saldo, quien)
    const sesion = mocks.createSession.mock.calls[0][0]
    expect(sesion.subscription_data).toEqual({ metadata: { workspace_id: 'w1', plan_id: 'p-saldo', modelo_cobro: 'saldo' } })
    expect(sesion.discounts).toEqual([{ coupon: 'riverz-first-month-35-usd-39900-v2' }])
  })

  it.each([
    ['new-balance-merchant-a', 'cus_new_a', 39900, true],
    ['new-balance-merchant-b', 'cus_new_b', 29900, false],
  ] as const)('keeps the admin agreement and account identity for %s', async (workspaceId, customerId, amount, freeMonth) => {
    mocks.retrieveCoupon.mockResolvedValue({
      id: firstMonthCouponId(amount, 'usd'), valid: true, duration: 'once',
      amount_off: firstMonthDiscountCents(amount), currency: 'usd',
    })
    const merchant = cuenta({
      ...saldo, workspaceId, stripeCustomerId: customerId,
      precioAcuerdoCentavos: amount, tratoPropio: true,
    })
    await urlDeCheckout(db, workspaceId, merchant, quien, { primerMesSinCargo: freeMonth })
    const session = mocks.createSession.mock.calls[0][0]
    expect(session.mode).toBe('subscription')
    expect(session.customer).toBe(customerId)
    expect(session.client_reference_id).toBe(workspaceId)
    expect(session.metadata.workspace_id).toBe(workspaceId)
    expect(session.subscription_data.metadata.workspace_id).toBe(workspaceId)
    expect(session.subscription_data.trial_period_days).toBe(freeMonth ? 30 : undefined)
    expect(session.payment_method_collection).toBe('always')
    expect(session.line_items).toHaveLength(1)
    expect(session.line_items[0].price_data.unit_amount).toBe(amount)
    expect(session.line_items[0].price_data.recurring.interval).toBe('month')
    expect(session.discounts).toEqual(freeMonth ? undefined : [{ coupon: firstMonthCouponId(amount, 'usd') }])
  })

  it('expires only this merchant subscription checkouts, not balance payments or other merchants', async () => {
    mocks.listSessions.mockReturnValue([
      { id: 'old', mode: 'subscription', metadata: { workspace_id: 'w1' } },
      { id: 'wallet', mode: 'payment', metadata: { workspace_id: 'w1' } },
      { id: 'other', mode: 'subscription', metadata: { workspace_id: 'w2' } },
    ])
    await expirarCheckoutsDelAcuerdo(saldo)
    expect(mocks.listSessions).toHaveBeenCalledWith({ customer: 'cus_1', status: 'open', limit: 100 })
    expect(mocks.expireSession).toHaveBeenCalledTimes(1)
    expect(mocks.expireSession).toHaveBeenCalledWith('old')
  })
})
