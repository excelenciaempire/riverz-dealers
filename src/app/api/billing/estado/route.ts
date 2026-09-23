import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { acceso, asegurarSuscripcion } from '@/lib/billing/plan'
import { cuentaDelPeriodo, periodoDe, usoDelPeriodo } from '@/lib/billing/uso'
import { stripeDisponible } from '@/lib/billing/stripe'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

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
  const periodo = periodoDe(sus)
  const uso = await usoDelPeriodo(admin, workspaceId, periodo, sus.modeloCobro === 'oficial')

  return NextResponse.json(
    {
      estado: sus.estado,
      modeloCobro: sus.modeloCobro,
      plan: sus.plan ? { nombre: sus.plan.nombre, slug: sus.plan.slug } : null,
      acceso: acceso(sus),
      cuenta: cuentaDelPeriodo(sus, uso),
      tratoPropio: sus.tratoPropio,
      // Lo que paga y cuándo vuelve a pagarlo: es lo primero que alguien busca
      // en esta pantalla y no estaba en ningún lado.
      precioCentavos: sus.precioCentavos,
      periodoHasta: sus.periodoHasta,
      puedeCancelar: stripeDisponible() && Boolean(sus.stripeSubscriptionId),
      // Sin Stripe configurado no se ofrece un botón que no puede funcionar.
      puedeSuscribirse: stripeDisponible() && Boolean(sus.plan) && sus.precioAcuerdoCentavos > 0,
      tienePortal: stripeDisponible() && Boolean(sus.stripeCustomerId),
      cancelarAlFinal: sus.cancelarAlFinal,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
