import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { acceso, asegurarSuscripcion, listarPlanes } from '@/lib/billing/plan'
import { cuentaDelPeriodo, periodoDe, usoDelPeriodo } from '@/lib/billing/uso'
import { stripeDisponible } from '@/lib/billing/stripe'
import { eligibleForFirstMonthOffer, firstMonthCents, FIRST_MONTH_DISCOUNT_PERCENT } from '@/lib/billing/first-month-offer'
import { createClient } from '@/lib/supabase/server'
import { isWorkspaceAdmin, resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getShopifyBillingConnection } from '@/lib/shopify/billing'

/**
 * Cómo está la cuenta con la facturación.
 *
 * Crea la suscripción si no existe: las cuentas que ya existían antes de que
 * esto existiera no tienen fila, y no por eso están vencidas. Arrancan su
 * prueba la primera vez que alguien mira.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const sus = await asegurarSuscripcion(admin, workspaceId)
  const shopifyConnection = await getShopifyBillingConnection(admin, workspaceId)
  const shopifyBilling = sus.billingProvider === 'shopify' ||
    (!sus.stripeSubscriptionId && Boolean(shopifyConnection))
  const periodo = periodoDe(sus)
  const uso = await usoDelPeriodo(admin, workspaceId, periodo, sus.modeloCobro === 'oficial')
  const puedeMejorar = sus.modeloCobro === 'oficial' && !sus.tratoPropio &&
    ['activa', 'prueba'].includes(sus.estado) && !sus.cancelarAlFinal &&
    await isWorkspaceAdmin(admin, user.id, workspaceId)
  const siguientesPlanes = puedeMejorar
    ? (await listarPlanes(admin)).filter((plan) => plan.activo &&
      plan.moneda === sus.plan?.moneda && plan.incluidas > sus.incluidas &&
      plan.precioCentavos > sus.precioAcuerdoCentavos)
      .map((plan) => ({ id: plan.id, slug: plan.slug, incluidas: plan.incluidas, precioCentavos: plan.precioCentavos }))
    : []

  return NextResponse.json(
    {
      estado: sus.estado,
      modeloCobro: sus.modeloCobro,
      plan: sus.plan ? { nombre: sus.plan.nombre, slug: sus.plan.slug } : null,
      acceso: acceso(sus),
      cuenta: cuentaDelPeriodo(sus, uso),
      siguientesPlanes,
      tratoPropio: sus.tratoPropio,
      // Lo que paga y cuándo vuelve a pagarlo: es lo primero que alguien busca
      // en esta pantalla y no estaba en ningún lado. La cuenta que todavía no
      // pagó ve lo que va a pagar.
      precioCentavos: sus.precioAcuerdoCentavos,
      primerMes: eligibleForFirstMonthOffer(sus) && sus.estado !== 'cortesia'
        ? { percent: FIRST_MONTH_DISCOUNT_PERCENT, centavos: firstMonthCents(sus.precioAcuerdoCentavos) }
        : null,
      periodoHasta: sus.periodoHasta,
      proveedorFacturacion: shopifyBilling ? 'shopify' : 'stripe',
      puedeCancelar: shopifyBilling
        ? Boolean(sus.shopifySubscriptionId && shopifyConnection)
        : stripeDisponible() && Boolean(sus.stripeSubscriptionId),
      // Sin Stripe configurado no se ofrece un botón que no puede funcionar.
      puedeSuscribirse: (shopifyBilling ? Boolean(shopifyConnection) : stripeDisponible()) &&
        Boolean(sus.plan) && sus.precioAcuerdoCentavos > 0,
      tienePortal: shopifyBilling
        ? Boolean(sus.shopifySubscriptionId && shopifyConnection)
        : stripeDisponible() && Boolean(sus.stripeCustomerId),
      cancelarAlFinal: sus.cancelarAlFinal,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
