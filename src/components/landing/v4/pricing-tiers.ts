export type PricingTier = { customers: number | null; monthly: number | null };

/** Lo que muestra la portada: los planes por contactos y el plan con saldo. */
export type PublicPricing = { tiers: PricingTier[]; balanceMonthly: number };

export const PRICING_TIERS: PricingTier[] = [
  { customers: 500, monthly: 399 },
  { customers: 2_000, monthly: 999 },
  { customers: 5_000, monthly: 1999 },
  { customers: 10_000, monthly: 3499 },
  { customers: null, monthly: null },
];

/** Mensualidad del plan con saldo (`saldo-ilimitado`); la IA se paga del saldo. */
export const BALANCE_PLAN_MONTHLY = 399;
