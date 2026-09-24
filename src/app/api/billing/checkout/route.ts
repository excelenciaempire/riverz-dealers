import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { asegurarSuscripcion } from '@/lib/billing/plan'
import { cancelarSuscripcion, urlDeCheckout, urlDelPortal } from '@/lib/billing/stripe'
import { csrfGuard } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import {
  createShopifySubscription,
  getShopifyBillingConnection,
  shopifyBillingPortalUrl,
} from '@/lib/shopify/billing'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Llevar a poner la tarjeta, o a cambiarla.
 *
 * Devuelve la URL y no redirige: quien la pide es un botón en el cliente, y una
 * redirección desde un `fetch` no lleva a ningún lado.
 *
 * Volver de Stripe NO activa nada. El estado lo escribe el webhook, que es la
 * única fuente: la URL de éxito la puede escribir cualquiera.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as {
    portal?: boolean
    /** true cancela al final del período; false se arrepiente. */
    cancelar?: boolean
  } | null
  const sus = await asegurarSuscripcion(admin, workspaceId)

  try {
    const shopifyConnection = await getShopifyBillingConnection(admin, workspaceId)
    const useShopify = sus.billingProvider === 'shopify' ||
      (!sus.stripeSubscriptionId && Boolean(shopifyConnection))
    if (useShopify) {
      if (!shopifyConnection) throw new Error('shopify_billing_connection_missing')
      if (body?.portal || body?.cancelar !== undefined) {
        return NextResponse.json({ url: shopifyBillingPortalUrl(shopifyConnection.shopDomain) })
      }
      if (!sus.plan) throw new Error('shopify_billing_plan_missing')
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
      return NextResponse.json({
        url: await createShopifySubscription({
          connection: shopifyConnection,
          plan: sus.plan,
          subscription: sus,
          returnOrigin: origin,
        }),
      })
    }
    if (body?.cancelar !== undefined) {
      await cancelarSuscripcion(sus, body.cancelar === true)
      // El estado lo escribe el webhook; acá sólo se confirma que se pidió.
      return NextResponse.json({ ok: true, cancelarAlFinal: body.cancelar === true })
    }
    if (body?.portal) {
      return NextResponse.json({ url: await urlDelPortal(sus) })
    }
    const { data: ws } = await admin
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .maybeSingle()
    const url = await urlDeCheckout(admin, workspaceId, sus, {
      email: user.email ?? null,
      nombre: (ws as { name?: string } | null)?.name ?? null,
    })
    return NextResponse.json({ url })
  } catch (e) {
    console.error('[billing/checkout] failed', workspaceId, e)
    return NextResponse.json(
      { error: translate(await getLocale(), 'settings.billingPaymentFailed') },
      { status: 400 },
    )
  }
}
