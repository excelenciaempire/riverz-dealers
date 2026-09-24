import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listarPlanes, leerSuscripcion } from '@/lib/billing/plan'
import { previsualizarAmpliacion, sincronizarPrecioSuscripcion } from '@/lib/billing/stripe'
import { signUpgradeQuote, verifyUpgradeQuote } from '@/lib/billing/upgrade-quote'
import { csrfGuard } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { isWorkspaceAdmin, resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { createShopifySubscription, getShopifyBillingConnection } from '@/lib/shopify/billing'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(db, user.id)
  if (!workspaceId || !await isWorkspaceAdmin(db, user.id, workspaceId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null) as { planId?: string; preview?: boolean; quote?: string } | null
  const [sus, planes] = await Promise.all([leerSuscripcion(db, workspaceId), listarPlanes(db)])
  const destino = planes.find((plan) => plan.id === body?.planId && plan.activo)
  const invalido = !sus || sus.modeloCobro !== 'oficial' || sus.tratoPropio ||
    !['activa', 'prueba'].includes(sus.estado) || sus.cancelarAlFinal ||
    !destino || destino.moneda !== sus.plan?.moneda ||
    destino.incluidas <= sus.incluidas || destino.precioCentavos <= sus.precioAcuerdoCentavos
  if (invalido || !sus || !destino || !sus.plan) return NextResponse.json({ error: translate(await getLocale(), 'settings.billingUpgradeUnavailable') }, { status: 400 })

  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY
    if (body?.preview) {
      if (sus.billingProvider === 'shopify') {
        return NextResponse.json({ provider: 'shopify', currency: destino.moneda, monthlyCents: destino.precioCentavos })
      }
      if (!sus.stripeSubscriptionId) {
        return NextResponse.json({ provider: 'trial', currency: destino.moneda, monthlyCents: destino.precioCentavos, amountCents: 0 })
      }
      if (!stripeSecret) throw new Error('stripe_unavailable')
      const amount = await previsualizarAmpliacion(sus, destino.precioCentavos, destino.moneda)
      return NextResponse.json({
        provider: 'stripe',
        currency: destino.moneda,
        monthlyCents: destino.precioCentavos,
        amountCents: amount.centavos,
        quote: signUpgradeQuote({
          workspaceId,
          subscriptionId: sus.stripeSubscriptionId,
          planId: destino.id,
          amountCents: amount.centavos,
          prorationDate: amount.fecha,
          monthlyCents: destino.precioCentavos,
          currency: destino.moneda,
        }, stripeSecret),
      })
    }
    if (sus.billingProvider === 'shopify') {
      const connection = await getShopifyBillingConnection(db, workspaceId)
      if (!connection) throw new Error('shopify_billing_connection_missing')
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
      const url = await createShopifySubscription({
        connection,
        plan: destino,
        subscription: sus,
        returnOrigin: origin,
        upgrade: true,
      })
      return NextResponse.json({ url })
    }
    if (sus.stripeSubscriptionId) {
      if (!stripeSecret) throw new Error('stripe_unavailable')
      const quote = verifyUpgradeQuote(body?.quote ?? '', {
        workspaceId,
        subscriptionId: sus.stripeSubscriptionId,
        planId: destino.id,
      }, stripeSecret)
      if (!quote || quote.monthlyCents !== destino.precioCentavos || quote.currency !== destino.moneda) {
        return NextResponse.json({ error: translate(await getLocale(), 'settings.billingUpgradeQuoteExpired') }, { status: 409 })
      }
      const current = await previsualizarAmpliacion(sus, destino.precioCentavos, destino.moneda, quote.prorationDate)
      if (current.centavos !== quote.amountCents) {
        return NextResponse.json({ error: translate(await getLocale(), 'settings.billingUpgradeQuoteExpired') }, { status: 409 })
      }
      await sincronizarPrecioSuscripcion(sus, destino.precioCentavos, destino.moneda, 'oficial', {
        planId: destino.id,
        prorationDate: quote.prorationDate,
      })
    }
    const { data: updated, error } = await db.from('workspace_subscriptions')
      .update({ plan_id: destino.id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('plan_id', sus.plan.id)
      .select('workspace_id')
    if (error || !updated?.length) {
      if (!sus.stripeSubscriptionId) throw error ?? new Error('subscription changed during upgrade')
      if (!error && (await leerSuscripcion(db, workspaceId))?.plan?.id === destino.id) {
        return NextResponse.json({ ok: true })
      }
      // Stripe ya pudo haber cobrado. El webhook lleva plan_id en metadata y
      // reconciliará la capacidad; nunca crear una segunda factura para "volver atrás".
      console.error('[billing/upgrade] Stripe changed but DB update pending', workspaceId, error)
      return NextResponse.json({ ok: true, pending: true }, { status: 202 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[billing/upgrade] failed', workspaceId, error)
    return NextResponse.json({ error: translate(await getLocale(), 'settings.billingUpgradeFailed') }, { status: 502 })
  }
}
