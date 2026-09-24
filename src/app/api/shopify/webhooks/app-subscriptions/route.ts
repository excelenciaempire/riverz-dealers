import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listarPlanes } from '@/lib/billing/plan'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'

interface SubscriptionPayload {
  app_subscription?: {
    admin_graphql_api_id?: string
    name?: string
    status?: string
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const db = supabaseAdmin()
  const verdict = await verifyShopifyWebhook(db, request, rawBody)
  if (verdict === 'unconfigured') return new NextResponse('Webhook not configured', { status: 503 })
  if (verdict === 'invalid') return new NextResponse('Invalid HMAC', { status: 401 })

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  if (!shopDomain) return new NextResponse('Missing shop', { status: 400 })
  const connection = await getConnectionByShop(db, shopDomain)
  if (!connection) return NextResponse.json({ ok: true })

  const payload = JSON.parse(rawBody) as SubscriptionPayload
  const subscription = payload.app_subscription
  const id = subscription?.admin_graphql_api_id
  const status = subscription?.status?.toUpperCase()
  if (!id || !status) return NextResponse.json({ ok: true })

  const now = new Date().toISOString()
  if (status === 'ACTIVE') {
    const slug = subscription.name?.startsWith('Riverz · ')
      ? subscription.name.slice('Riverz · '.length)
      : null
    const plan = slug ? (await listarPlanes(db)).find((item) => item.slug === slug) : null
    await db.from('workspace_subscriptions').update({
      ...(plan ? { plan_id: plan.id } : {}),
      estado: 'activa',
      stripe_subscription_id: id,
      stripe_customer_id: shopDomain,
      vencida_desde: null,
      cancelar_al_final: false,
      updated_at: now,
    }).eq('workspace_id', connection.row.workspace_id)
  } else if (status === 'FROZEN') {
    await db.from('workspace_subscriptions').update({
      estado: 'vencida',
      vencida_desde: now,
      updated_at: now,
    }).eq('workspace_id', connection.row.workspace_id)
      .eq('stripe_subscription_id', id)
  } else if (['CANCELLED', 'DECLINED', 'EXPIRED'].includes(status)) {
    // Match the current ID: during an upgrade Shopify cancels the old charge
    // and activates the replacement in two separate deliveries.
    await db.from('workspace_subscriptions').update({
      estado: 'cancelada',
      cancelar_al_final: true,
      updated_at: now,
    }).eq('workspace_id', connection.row.workspace_id)
      .eq('stripe_subscription_id', id)
  }

  return NextResponse.json({ ok: true })
}
