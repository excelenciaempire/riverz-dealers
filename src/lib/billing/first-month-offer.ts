import type { Suscripcion } from './plan'

/** Oferta pública para el primer cobro de las cuentas Todo incluido. */
export const FIRST_MONTH_DISCOUNT_PERCENT = 35

export function firstMonthCents(monthlyCents: number): number {
  return Math.floor(monthlyCents * (100 - FIRST_MONTH_DISCOUNT_PERCENT) / 10_000) * 100
}

export function firstMonthDiscountCents(monthlyCents: number): number {
  return monthlyCents - firstMonthCents(monthlyCents)
}

export function firstMonthCouponId(monthlyCents: number, currency: string): string {
  return `riverz-first-month-35-${currency.toLowerCase()}-${monthlyCents}-v2`
}

/**
 * Días de prueba cuando el primer mes va sin cargo. Se cuentan desde que el
 * comercio completa el pago, no desde que se armó el link: Stripe muestra
 * «30 días gratis» y no el resto redondeado hacia abajo.
 */
export const FREE_FIRST_MONTH_DAYS = 30

export function eligibleForFirstMonthOffer(
  subscription: Pick<Suscripcion, 'modeloCobro' | 'stripeSubscriptionId' | 'precioAcuerdoCentavos'> & {
    plan?: Pick<NonNullable<Suscripcion['plan']>, 'slug'> | null
  },
): boolean {
  return (subscription.modeloCobro === 'oficial' ||
    (subscription.modeloCobro === 'saldo' && subscription.plan?.slug === 'saldo-ilimitado')) &&
    !subscription.stripeSubscriptionId && subscription.precioAcuerdoCentavos > 0 &&
    firstMonthCents(subscription.precioAcuerdoCentavos) > 0
}
