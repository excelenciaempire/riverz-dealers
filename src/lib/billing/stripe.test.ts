import { describe, expect, it } from 'vitest'
import type { Suscripcion } from './plan'
import { lineItemsDeSuscripcion, sumarProrrateo } from './stripe'

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
})

describe('prorrateo de ampliación', () => {
  const line = (amount: number, proration: boolean, tax = 0) => ({
    amount,
    taxes: tax ? [{ amount: tax }] : null,
    parent: { subscription_item_details: { proration } },
  })

  it('resta el crédito del plan anterior y no incluye la renovación', () => {
    expect(sumarProrrateo([
      line(-19950, true),
      line(49950, true, 1500),
      line(99900, false),
    ])).toBe(31500)
  })

  it('no inventa un importe si Stripe no devuelve prorrateos', () => {
    expect(sumarProrrateo([line(99900, false)])).toBeNull()
  })
})
