import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Plan, Suscripcion } from '@/lib/billing/plan'
import { FIRST_MONTH_DISCOUNT_PERCENT } from '@/lib/billing/first-month-offer'
import { decrypt } from '@/lib/whatsapp/encryption'
import { ShopifyAdminClient } from './admin-client'
import { COLUMNAS_TOKEN, tokenVivo } from './token-vivo'

export interface ShopifyBillingConnection {
  id: string
  workspaceId: string
  shopDomain: string
  accessToken: string
}

interface BillingState {
  workspaceId: string
  shopDomain: string
  planId: string
  expiresAt: number
}

const CREATE_SUBSCRIPTION = `#graphql
  mutation RiverzSubscription(
    $name: String!
    $returnUrl: URL!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $replacementBehavior: AppSubscriptionReplacementBehavior
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      replacementBehavior: $replacementBehavior
      test: $test
      trialDays: $trialDays
    ) {
      appSubscription { id name status }
      confirmationUrl
      userErrors { field message }
    }
  }
`

const CURRENT_SUBSCRIPTIONS = `#graphql
  query RiverzSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        test
      }
    }
  }
`

const SHOP_PLAN = `#graphql
  query RiverzShopPlan { shop { plan { partnerDevelopment } } }
`

function billingSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET
  if (!secret) throw new Error('Shopify billing is not configured')
  return secret
}

function equalBase64Url(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function signShopifyBillingState(
  state: BillingState,
  secret = billingSecret(),
): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyShopifyBillingState(
  token: string,
  secret = billingSecret(),
  now = Date.now(),
): BillingState | null {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  if (!equalBase64Url(signature, expected)) return null
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as BillingState
    if (!state.workspaceId || !state.shopDomain || !state.planId || state.expiresAt < now) {
      return null
    }
    return state
  } catch {
    return null
  }
}

/** Public OAuth installs must use Shopify Billing; custom integrations stay on Stripe. */
export async function getShopifyBillingConnection(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ShopifyBillingConnection | null> {
  const publicClientId = process.env.SHOPIFY_API_KEY
  if (!publicClientId) return null
  const { data, error } = await db
    .from('shopify_connections')
    .select(`${COLUMNAS_TOKEN}, workspace_id, status`)
    .eq('platform', 'shopify')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .eq('connection_method', 'oauth')
    .order('installed_at', { ascending: false })
    .limit(5)
  if (error) throw new Error(error.message)
  for (const raw of data ?? []) {
    const row = raw as Parameters<typeof tokenVivo>[1] & { workspace_id: string }
    if (!row.client_id_encrypted) continue
    try {
      if (decrypt(row.client_id_encrypted) !== publicClientId) continue
      const token = await tokenVivo(db, row)
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        shopDomain: row.shop_domain,
        accessToken: token.accessToken,
      }
    } catch {
      continue
    }
  }
  return null
}

export function shopifySubscriptionName(plan: Pick<Plan, 'slug'>): string {
  return `Riverz · ${plan.slug}`
}

export async function createShopifySubscription(args: {
  connection: ShopifyBillingConnection
  plan: Plan
  subscription: Suscripcion
  returnOrigin: string
  upgrade?: boolean
}): Promise<string> {
  const { connection, plan, subscription } = args
  if (!plan.activo || plan.precioCentavos <= 0) throw new Error('Invalid Shopify billing plan')
  const state = signShopifyBillingState({
    workspaceId: connection.workspaceId,
    shopDomain: connection.shopDomain,
    planId: plan.id,
    expiresAt: Date.now() + 30 * 60_000,
  })
  const returnUrl = new URL('/api/billing/shopify/callback', args.returnOrigin)
  returnUrl.searchParams.set('state', state)

  const client = new ShopifyAdminClient(connection.shopDomain, connection.accessToken)
  const shopPlan = await client.graphql<{
    shop: { plan: { partnerDevelopment: boolean } }
  }>(SHOP_PLAN)
  const trialDays = subscription.estado === 'prueba' && subscription.pruebaHasta
    ? Math.max(0, Math.ceil((Date.parse(subscription.pruebaHasta) - Date.now()) / 86_400_000))
    : 0
  const recurring: Record<string, unknown> = {
    interval: 'EVERY_30_DAYS',
    price: {
      amount: (plan.precioCentavos / 100).toFixed(2),
      currencyCode: plan.moneda.toUpperCase(),
    },
  }
  // Match Riverz's published first-month offer inside Shopify itself.
  if (!args.upgrade && !subscription.shopifySubscriptionId) {
    recurring.discount = {
      durationLimitInIntervals: 1,
      value: { percentage: FIRST_MONTH_DISCOUNT_PERCENT / 100 },
    }
  }
  const data = await client.graphql<{
    appSubscriptionCreate: {
      confirmationUrl: string | null
      userErrors: Array<{ message: string }>
    }
  }>(CREATE_SUBSCRIPTION, {
    name: shopifySubscriptionName(plan),
    returnUrl: returnUrl.toString(),
    lineItems: [{ plan: { appRecurringPricingDetails: recurring } }],
    replacementBehavior: args.upgrade ? 'APPLY_IMMEDIATELY' : 'STANDARD',
    test: shopPlan.shop.plan.partnerDevelopment || process.env.SHOPIFY_BILLING_TEST_MODE === '1',
    trialDays: trialDays || null,
  })
  const result = data.appSubscriptionCreate
  if (result.userErrors.length) {
    throw new Error(result.userErrors.map((error) => error.message).join('; '))
  }
  if (!result.confirmationUrl) throw new Error('Shopify returned no billing confirmation URL')
  return result.confirmationUrl
}

export async function readActiveShopifySubscriptions(connection: ShopifyBillingConnection) {
  const client = new ShopifyAdminClient(connection.shopDomain, connection.accessToken)
  const data = await client.graphql<{
    currentAppInstallation: {
      activeSubscriptions: Array<{
        id: string
        name: string
        status: string
        currentPeriodEnd: string | null
        test: boolean
      }>
    }
  }>(CURRENT_SUBSCRIPTIONS)
  return data.currentAppInstallation.activeSubscriptions
}

export function shopifyBillingPortalUrl(shopDomain: string): string {
  const handle = shopDomain.replace(/\.myshopify\.com$/i, '')
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/settings/billing`
}
