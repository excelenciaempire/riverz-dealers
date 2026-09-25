import 'server-only'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import {
  BALANCE_PLAN_MONTHLY,
  PRICING_TIERS,
  type PricingTier,
  type PublicPricing,
} from '@/components/landing/v4/pricing-tiers'

const PUBLIC_SLUGS = ['contactos-500', 'contactos-2000', 'contactos-5000', 'contactos-10000'] as const
const BALANCE_SLUG = 'saldo-ilimitado'

/** Los precios visibles salen de los mismos planes que usa Checkout. */
export async function publicPricing(): Promise<PublicPricing> {
  const { data, error } = await supabaseAdmin().from('billing_plans')
    .select('slug, activo, precio_centavos, incluidas, moneda')
    .in('slug', [...PUBLIC_SLUGS, BALANCE_SLUG])
  if (error) {
    console.error('[billing/public-pricing] no se pudieron leer los planes', error)
    return { tiers: PRICING_TIERS, balanceMonthly: BALANCE_PLAN_MONTHLY }
  }
  const plans = new Map((data ?? []).filter((row) => row.activo && row.moneda === 'usd')
    .map((row) => [row.slug, row]))
  const balance = plans.get(BALANCE_SLUG)
  if (!balance) console.error('[billing/public-pricing] falta el plan con saldo activo')
  const balanceMonthly = balance ? balance.precio_centavos / 100 : BALANCE_PLAN_MONTHLY
  if (PUBLIC_SLUGS.some((slug) => !plans.has(slug))) {
    console.error('[billing/public-pricing] falta un plan público activo')
    return { tiers: PRICING_TIERS, balanceMonthly }
  }
  return {
    tiers: [
      ...PUBLIC_SLUGS.map((slug) => {
        const plan = plans.get(slug)!
        return { customers: plan.incluidas, monthly: plan.precio_centavos / 100 }
      }),
      { customers: null, monthly: null },
    ],
    balanceMonthly,
  }
}

/** Sólo los planes por contactos: la calculadora no muestra el de saldo. */
export async function publicPricingTiers(): Promise<PricingTier[]> {
  return (await publicPricing()).tiers
}
