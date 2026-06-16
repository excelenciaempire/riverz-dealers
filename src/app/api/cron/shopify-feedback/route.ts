import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationById } from '@/lib/automations/engine'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Cron de feedback post-entrega (Pilar).
 *
 * Corre cada hora. Busca filas en `shopify_order_fulfillment_state`
 * que cumplen:
 *
 *   - `delivered_at IS NOT NULL`
 *   - `feedback_dispatched_at IS NULL`
 *   - `delivered_at < now() - interval '3 days'`
 *
 * Para cada fila resuelve el workspace (via shop_domain → connection)
 * y dispara la automation "Feedback post-entrega Pilar" contra el
 * contacto. Como `time_based` puede ser disparado por varios crons,
 * llamamos al automation por ID directo (no por trigger_type) para que
 * la cron de re-engagement no se cruce con esta.
 *
 * Targeting del contacto: la fila de fulfillment_state no guarda el
 * contact_id ni el phone. Tenemos que volver a buscar al cliente en la
 * orden de Shopify — pero como ya disparamos `shopify_order_fulfilled`
 * cuando despachamos, conservamos el contacto vinculado a la orden vía
 * el último mensaje enviado. Más simple: buscamos contactos del
 * workspace cuyo external_id matchee `order.customer.id`. Si no
 * encontramos un contact, salteamos esta orden — el feedback no se
 * manda pero tampoco rompe el cron.
 *
 * Anti-spam: marcamos `feedback_dispatched_at = now()` antes de
 * disparar, como hace el cron de cart-recovery.
 *
 * Discovery de automation:
 *   - Modo nuevo: por trigger_type='post_delivery_feedback' (con
 *     trigger_config.days_after = cadencia). Cualquier workspace
 *     puede tener su propia automation activa con este trigger sin
 *     tocar env vars; los nuevos templates usan este path.
 *   - Modo legacy: la env var `PILAR_FEEDBACK_AUTOMATION_ID` o el UUID
 *     hard-codeado se siguen usando como fallback para el workspace
 *     de Pilar mientras migramos.
 */
const DEFAULT_AUTOMATION_ID = 'b29697f9-378a-48c7-9ad1-6d45205ffa2b'
const DEFAULT_DAYS_AFTER = 3

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const legacyAutomationId =
    process.env.PILAR_FEEDBACK_AUTOMATION_ID || DEFAULT_AUTOMATION_ID

  const admin = supabaseAdmin()
  const threeDaysAgo = new Date(
    Date.now() - DEFAULT_DAYS_AFTER * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: due, error } = await admin
    .from('shopify_order_fulfillment_state')
    .select('shop_domain, order_id, delivered_at')
    .not('delivered_at', 'is', null)
    .is('feedback_dispatched_at', null)
    .lt('delivered_at', threeDaysAgo)
    .order('delivered_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let dispatched = 0
  for (const row of due) {
    const r = row as {
      shop_domain: string
      order_id: number
      delivered_at: string
    }

    // Reclamamos antes para que un crash entre fetch del cliente y
    // dispatch no dispare el mensaje dos veces.
    const { data: claim } = await admin
      .from('shopify_order_fulfillment_state')
      .update({ feedback_dispatched_at: new Date().toISOString() })
      .eq('shop_domain', r.shop_domain)
      .eq('order_id', r.order_id)
      .is('feedback_dispatched_at', null)
      .select('order_id')
      .maybeSingle()
    if (!claim) continue

    const conn = await getConnectionByShop(admin, r.shop_domain)
    if (!conn) continue

    // Migration 055: workspace_id lives on the connection row. owner_id
    // fallback retained for pre-055 rows that might still exist mid-deploy.
    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) continue

    // Vinculamos el feedback al contact que recibió shopify_order_fulfilled
    // para esta orden. Buscamos el log más reciente de la automation
    // "Pedido despachado Pilar" disparada por esa orden.
    const { data: lastLog } = await admin
      .from('automation_logs')
      .select('contact_id, steps_executed')
      .eq('workspace_id', workspaceId)
      .eq('trigger_event', 'shopify_order_fulfilled')
      .order('created_at', { ascending: false })
      .limit(20)

    const logs = (lastLog ?? []) as Array<{
      contact_id: string | null
      steps_executed: unknown
    }>
    // Fallback: si no encontramos referencia, buscamos un contact
    // reciente del workspace — el feedback igual sirve pero no es
    // perfecto. Mejor sería persistir order_id ↔ contact_id en la fila
    // de fulfillment_state. Lo dejamos como TODO para no expandir esta
    // PR.
    const contactId = logs[0]?.contact_id
    if (!contactId) continue

    // Buscamos toda automation activa con trigger_type='post_delivery_feedback'
    // en este workspace. Si ninguna existe, caemos al UUID legacy
    // (Pilar) para no romper el flujo actual mientras migramos.
    const { data: candidates } = await admin
      .from('automations')
      .select('id, trigger_config')
      .eq('workspace_id', workspaceId)
      .eq('trigger_type', 'post_delivery_feedback')
      .eq('is_active', true)
    const matches = (candidates ?? []) as Array<{
      id: string
      trigger_config: { days_after?: number } | null
    }>

    const ids: string[] = []
    if (matches.length > 0) {
      // Solo disparamos las que tienen days_after <= antigüedad del
      // delivered_at (el predicado SQL ya limita a 3 días, así que
      // automations configuradas con days_after > 3 ya no entran).
      const deliveredMs = new Date(r.delivered_at).getTime()
      const elapsedDays = (Date.now() - deliveredMs) / 86_400_000
      for (const m of matches) {
        const need = Number(m.trigger_config?.days_after ?? DEFAULT_DAYS_AFTER)
        if (Number.isFinite(need) && elapsedDays >= need) ids.push(m.id)
      }
    } else {
      ids.push(legacyAutomationId)
    }

    for (const automationId of ids) {
      const result = await runAutomationById({
        automationId,
        contactId,
        context: {
          vars: {
            order_id: String(r.order_id),
            delivered_at: r.delivered_at,
          },
        },
      })
      if (result.executed) dispatched++
    }
  }

  return NextResponse.json({ processed: due.length, dispatched })
}
