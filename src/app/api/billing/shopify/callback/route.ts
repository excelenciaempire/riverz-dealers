import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listarPlanes } from '@/lib/billing/plan'
import { getLocale } from '@/lib/i18n/server'
import { localizePath } from '@/lib/i18n/routes'
import {
  getShopifyBillingConnection,
  readActiveShopifySubscriptions,
  shopifySubscriptionName,
  verifyShopifyBillingState,
} from '@/lib/shopify/billing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function finish(request: Request, ok: boolean) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  const url = new URL(localizePath('/ajustes', await getLocale()), origin)
  url.searchParams.set('tab', 'facturacion')
  url.searchParams.set('shopifyBilling', ok ? 'active' : 'error')
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('state') ?? ''
  const state = verifyShopifyBillingState(token)
  if (!state) return finish(request, false)

  try {
    const db = supabaseAdmin()
    const [connection, plans] = await Promise.all([
      getShopifyBillingConnection(db, state.workspaceId),
      listarPlanes(db),
    ])
    const plan = plans.find((candidate) => candidate.id === state.planId && candidate.activo)
    if (!connection || connection.shopDomain !== state.shopDomain || !plan) {
      return finish(request, false)
    }
    const active = (await readActiveShopifySubscriptions(connection)).find(
      (subscription) => subscription.name === shopifySubscriptionName(plan) &&
        subscription.status === 'ACTIVE',
    )
    if (!active) return finish(request, false)

    const now = new Date().toISOString()
    const { error } = await db.from('workspace_subscriptions').update({
      plan_id: plan.id,
      estado: 'activa',
      // Shopify GIDs make the provider self-describing while preserving the
      // existing schema used by Stripe subscriptions.
      stripe_customer_id: connection.shopDomain,
      stripe_subscription_id: active.id,
      prueba_hasta: null,
      periodo_desde: now,
      periodo_hasta: active.currentPeriodEnd,
      vencida_desde: null,
      cancelar_al_final: false,
      updated_at: now,
    }).eq('workspace_id', state.workspaceId)
    if (error) throw new Error(error.message)
    return finish(request, true)
  } catch (error) {
    console.error('[billing/shopify/callback] failed', error)
    return finish(request, false)
  }
}
