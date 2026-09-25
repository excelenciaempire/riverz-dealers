import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Suscripcion } from './plan'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  retrieveCoupon: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: mocks.createSession } }
    coupons = { retrieve: mocks.retrieveCoupon }
  },
}))
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => 'es' }))

import { lineItemsDeSuscripcion, urlDeCheckout } from './stripe'

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
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    mocks.createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    mocks.retrieveCoupon.mockResolvedValue({
      id: 'riverz-first-month-35-usd-39900-v2', valid: true, duration: 'once', amount_off: 14000, currency: 'usd',
    })
  })
  afterEach(() => vi.useRealTimers())

  it('no cobra el primer mes ya pagado y cobra la mensualidad completa al mes siguiente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T18:30:00.000Z'))
    const url = await urlDeCheckout(db, 'w1', saldo, quien, { primerMesSinCargo: true })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_1')
    const sesion = mocks.createSession.mock.calls[0][0]
    expect(sesion.subscription_data).toEqual({
      metadata: { workspace_id: 'w1' },
      trial_end: Date.parse('2026-10-25T18:30:00.000Z') / 1000,
    })
    expect(sesion.discounts).toBeUndefined()
    expect(mocks.retrieveCoupon).not.toHaveBeenCalled()
    expect(sesion.line_items[0].price_data.unit_amount).toBe(39900)
  })

  it('sin esa opción cobra hoy con la promoción del primer mes', async () => {
    await urlDeCheckout(db, 'w1', saldo, quien)
    const sesion = mocks.createSession.mock.calls[0][0]
    expect(sesion.subscription_data).toEqual({ metadata: { workspace_id: 'w1' } })
    expect(sesion.discounts).toEqual([{ coupon: 'riverz-first-month-35-usd-39900-v2' }])
  })
})
