import 'server-only'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { PRICING_TIERS, type PricingTier } from '@/components/landing/v4/pricing-tiers'

const PUBLIC_SLUGS = ['contactos-500', 'contactos-2000', 'contactos-5000', 'contactos-10000'] as const

/** Los precios visibles salen de los mismos planes que usa Checkout. */
export async function publicPricingTiers(): Promise<PricingTier[]> {
  const { data, error } = await supabaseAdmin().from('billing_plans')
    .select('slug, activo, precio_centavos, incluidas, moneda')
    .in('slug', [...PUBLIC_SLUGS])
  if (error) {
    console.error('[billing/public-pricing] no se pudieron leer los planes', error)
    return PRICING_TIERS
  }
  const plans = new Map((data ?? []).filter((row) => row.activo && row.moneda === 'usd')
    .map((row) => [row.slug, row]))
  if (PUBLIC_SLUGS.some((slug) => !plans.has(slug))) {
    console.error('[billing/public-pricing] falta un plan público activo')
    return PRICING_TIERS
  }
  return [
    ...PUBLIC_SLUGS.map((slug) => {
      const plan = plans.get(slug)!
      return { customers: plan.incluidas, monthly: plan.precio_centavos / 100 }
    }),
    { customers: null, monthly: null },
  ]
}
