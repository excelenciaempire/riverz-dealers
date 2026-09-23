import type { Suscripcion } from './plan'

/** Oferta pública para el primer cobro de las cuentas Todo incluido. */
export const FIRST_MONTH_DISCOUNT_PERCENT = 35
export const FIRST_MONTH_COUPON_ID = 'riverz-first-month-35-v1'

export function firstMonthCents(monthlyCents: number): number {
  return Math.round(monthlyCents * (100 - FIRST_MONTH_DISCOUNT_PERCENT) / 100)
}

export function eligibleForFirstMonthOffer(
  subscription: Pick<Suscripcion, 'modeloCobro' | 'stripeSubscriptionId' | 'precioAcuerdoCentavos'>,
): boolean {
  return subscription.modeloCobro === 'oficial' &&
    !subscription.stripeSubscriptionId && subscription.precioAcuerdoCentavos > 0
}
