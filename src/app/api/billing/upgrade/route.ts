import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listarPlanes, leerSuscripcion } from '@/lib/billing/plan'
import { sincronizarPrecioSuscripcion } from '@/lib/billing/stripe'
import { csrfGuard } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { isWorkspaceAdmin, resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

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
  const body = await request.json().catch(() => null) as { planId?: string } | null
  const [sus, planes] = await Promise.all([leerSuscripcion(db, workspaceId), listarPlanes(db)])
  const destino = planes.find((plan) => plan.id === body?.planId && plan.activo)
  const invalido = !sus || sus.modeloCobro !== 'oficial' || sus.tratoPropio ||
    !['activa', 'prueba'].includes(sus.estado) || sus.cancelarAlFinal ||
    !destino || destino.moneda !== sus.plan?.moneda ||
    destino.incluidas <= sus.incluidas || destino.precioCentavos <= sus.precioAcuerdoCentavos
  if (invalido || !sus || !destino || !sus.plan) return NextResponse.json({ error: translate(await getLocale(), 'settings.billingUpgradeUnavailable') }, { status: 400 })

  try {
    // Sin prorrateo: más capacidad desde ahora, nuevo precio en la renovación.
    // Stripe se modifica primero; si la DB falla, se restaura el precio anterior.
    await sincronizarPrecioSuscripcion(sus, destino.precioCentavos, destino.moneda, 'oficial')
    const { data: updated, error } = await db.from('workspace_subscriptions')
      .update({ plan_id: destino.id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('plan_id', sus.plan.id)
      .select('workspace_id')
    if (error || !updated?.length) throw error ?? new Error('subscription changed during upgrade')
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (sus.stripeSubscriptionId) {
      try {
        await sincronizarPrecioSuscripcion(sus, sus.precioAcuerdoCentavos, sus.plan!.moneda, 'oficial')
      } catch (rollbackError) {
        console.error('[billing/upgrade] Stripe rollback failed', workspaceId, rollbackError)
      }
    }
    console.error('[billing/upgrade] failed', workspaceId, error)
    return NextResponse.json({ error: translate(await getLocale(), 'settings.billingUpgradeFailed') }, { status: 502 })
  }
}
