export type PricingTier = { customers: number | null; monthly: number | null };

export const PRICING_TIERS: PricingTier[] = [
  { customers: 500, monthly: 399 },
  { customers: 2_000, monthly: 999 },
  { customers: 5_000, monthly: 1999 },
  { customers: 10_000, monthly: 3499 },
  { customers: null, monthly: null },
];
