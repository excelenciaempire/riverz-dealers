import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Plan, Suscripcion } from './plan'

const mocks = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  createPrice: vi.fn(),
  listInvoices: vi.fn(),
  createInvoice: vi.fn(),
  createItem: vi.fn(),
  finalizeInvoice: vi.fn(),
  payInvoice: vi.fn(),
  retrieveInvoice: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { retrieve: mocks.retrieveSubscription, update: mocks.updateSubscription }
    prices = { create: mocks.createPrice }
    invoices = {
      list: mocks.listInvoices,
      create: mocks.createInvoice,
      finalizeInvoice: mocks.finalizeInvoice,
      pay: mocks.payInvoice,
      retrieve: mocks.retrieveInvoice,
    }
    invoiceItems = { create: mocks.createItem }
  },
}))

import { cobrarAmpliacionCapacidad, previsualizarAmpliacion, sincronizarPrecioSuscripcion } from './stripe'

const origen: Plan = {
  id: 'p2', slug: 'contactos-2000', nombre: 'Hasta 2000 contactos', activo: true,
  precioCentavos: 99900, moneda: 'usd', incluidas: 2000, excedenteCentavos: 0,
  stripePriceId: null, stripePriceExcedenteId: null, orden: 2,
}
const destino: Plan = { ...origen, id: 'p5', slug: 'contactos-5000', precioCentavos: 199900, incluidas: 5000, orden: 3 }
const suscripcion: Suscripcion = {
  workspaceId: 'w1', plan: origen, estado: 'activa', pruebaHasta: null,
  periodoDesde: null, periodoHasta: null, vencidaDesde: null, nota: null,
  stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', billingProvider: 'stripe',
  shopifySubscriptionId: null, shopifyShopDomain: null, cancelarAlFinal: false,
  modeloCobro: 'oficial', precioCentavos: 99900, precioAcuerdoCentavos: 99900,
  incluidas: 2000, excedenteCentavos: 0, tratoPropio: false,
}

const stripeSubscription = {
  id: 'sub_1', customer: 'cus_1', status: 'active', start_date: 1000,
  items: { data: [{ id: 'si_1', current_period_start: 1000,
    price: { id: 'price_2', product: 'prod_1', currency: 'usd', unit_amount: 99900,
      recurring: { interval: 'month', usage_type: 'licensed' } } }] },
}

describe('ampliación de capacidad en Stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    mocks.retrieveSubscription.mockResolvedValue(stripeSubscription)
    mocks.listInvoices.mockResolvedValue({ data: [] })
  })

  it('cotiza la diferencia completa y conserva el inicio del ciclo', async () => {
    const quote = await previsualizarAmpliacion(suscripcion, destino.precioCentavos, 'usd')
    expect(quote.centavos).toBe(100000)
    expect(quote.periodStart).toBe(1000)
    expect(quote.firstCycle).toBe(true)
  })

  it('cambia la mensualidad futura sin mover la renovación ni prorratear otra vez', async () => {
    mocks.createPrice.mockResolvedValue({ id: 'price_5' })
    mocks.updateSubscription.mockResolvedValue({ id: 'sub_1' })
    await sincronizarPrecioSuscripcion(suscripcion, destino.precioCentavos, 'usd', 'oficial', {
      planId: destino.id, invoiceId: 'in_paid',
    })
    expect(mocks.updateSubscription).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      billing_cycle_anchor: 'unchanged', proration_behavior: 'none',
      items: [{ id: 'si_1', price: 'price_5', quantity: 1 }],
      metadata: { plan_id: 'p5', modelo_cobro: 'oficial', capacity_upgrade_invoice_id: 'in_paid' },
    }), expect.anything())
  })

  it('no activa el nuevo cupo si la factura todavía no está pagada', async () => {
    const invoice = { id: 'in_open', status: 'open', amount_due: 100001,
      hosted_invoice_url: 'https://invoice.stripe.com/test', metadata: {} }
    mocks.createInvoice.mockResolvedValue(invoice)
    const result = await cobrarAmpliacionCapacidad({} as SupabaseClient, suscripcion, destino, 1000, 100000)
    expect(result).toEqual({ paid: false, url: invoice.hosted_invoice_url })
    expect(mocks.payInvoice).not.toHaveBeenCalled()
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it.each(['oficial', 'byok', 'saldo'] as const)('sincroniza el cambio a %s sin cobro inmediato', async modelo => {
    mocks.retrieveSubscription.mockResolvedValue({ ...stripeSubscription,
      items: { data: [...stripeSubscription.items.data, { id: 'si_meter', price: { recurring: { usage_type: 'metered' } } }] } })
    mocks.createPrice.mockResolvedValue({ id: 'price_new' })
    await sincronizarPrecioSuscripcion(suscripcion, 99900, 'usd', modelo,
      { planId: 'new', planName: 'Nuevo plan' }, true)
    expect(mocks.createPrice).toHaveBeenCalledWith(expect.objectContaining({
      product_data: { name: 'Riverz · Nuevo plan' }, unit_amount: 99900,
    }), expect.anything())
    expect(mocks.updateSubscription).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      metadata: { plan_id: 'new', modelo_cobro: modelo },
      items: [{ id: 'si_1', price: 'price_new', quantity: 1 }, { id: 'si_meter', deleted: true }],
      billing_cycle_anchor: 'unchanged', proration_behavior: 'none',
    }), undefined)
    expect(mocks.createInvoice).not.toHaveBeenCalled()
    expect(mocks.payInvoice).not.toHaveBeenCalled()
  })
})
