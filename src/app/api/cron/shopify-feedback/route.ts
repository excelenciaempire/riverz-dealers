import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationById } from '@/lib/automations/engine'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { pingCron } from '@/lib/cron/heartbeat'

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
 *   - Por trigger_type='post_delivery_feedback' (con
 *     trigger_config.days_after = cadencia). Cualquier workspace
 *     puede tener su propia automation activa con este trigger sin
 *     tocar env vars. Si el workspace no tiene una automation activa
 *     con este trigger, no se dispara nada (sin fallback cross-tenant).
 */
const DEFAULT_DAYS_AFTER = 3

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }
  void pingCron('shopify-feedback')

  const admin = supabaseAdmin()
  const threeDaysAgo = new Date(
    Date.now() - DEFAULT_DAYS_AFTER * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: due, error } = await admin
    .from('shopify_order_fulfillment_state')
    .select('shop_domain, order_id, delivered_at, contact_id')
    .not('delivered_at', 'is', null)
    .is('feedback_dispatched_at', null)
    .lt('delivered_at', threeDaysAgo)
    .order('delivered_at', { ascending: true })
    .limit(50)

  if (error) return serverError(error)
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let dispatched = 0
  let skipped = 0

  // Helper to release a just-claimed row when we end up not actually
  // dispatching (no workspace / no contact / no automation matched).
  // Without this, every transient miss permanently burns the feedback
  // claim and the cron's "processed: N" metric hides the silent loss.
  async function releaseClaim(shopDomain: string, orderId: number) {
    await admin
      .from('shopify_order_fulfillment_state')
      .update({ feedback_dispatched_at: null })
      .eq('shop_domain', shopDomain)
      .eq('order_id', orderId)
  }

  for (const row of due) {
    const r = row as {
      shop_domain: string
      order_id: number
      delivered_at: string
      contact_id: string | null
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
    if (!conn) {
      await releaseClaim(r.shop_domain, r.order_id)
      skipped++
      continue
    }

    // Migration 055: workspace_id lives on the connection row. owner_id
    // fallback retained for pre-055 rows that might still exist mid-deploy.
    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) {
      await releaseClaim(r.shop_domain, r.order_id)
      skipped++
      continue
    }

    // Preferimos el contact_id que la webhook de orders estampó en la
    // fila para ESTA orden (migración 061) — es el cliente correcto.
    // Para filas viejas sin contact_id, caemos al heurístico legacy:
    // el log más reciente de shopify_order_fulfilled del workspace
    // (impreciso con varios pedidos en vuelo, pero no rompe).
    let contactId: string | null = r.contact_id
    if (!contactId) {
      const { data: lastLog } = await admin
        .from('automation_logs')
        .select('contact_id')
        .eq('workspace_id', workspaceId)
        .eq('trigger_event', 'shopify_order_fulfilled')
        .order('created_at', { ascending: false })
        .limit(1)
      contactId = (lastLog ?? [])[0]?.contact_id ?? null
    }
    if (!contactId) {
      await releaseClaim(r.shop_domain, r.order_id)
      skipped++
      continue
    }

    // Buscamos toda automation activa con trigger_type='post_delivery_feedback'
    // en este workspace. Si ninguna existe, no se dispara nada para este
    // workspace (sin fallback cross-tenant) y se libera el claim abajo.
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

    // Solo disparamos las que tienen days_after <= antigüedad del
    // delivered_at (el predicado SQL ya limita a 3 días, así que
    // automations configuradas con days_after > 3 ya no entran).
    const ids: string[] = []
    const deliveredMs = new Date(r.delivered_at).getTime()
    const elapsedDays = (Date.now() - deliveredMs) / 86_400_000
    for (const m of matches) {
      const need = Number(m.trigger_config?.days_after ?? DEFAULT_DAYS_AFTER)
      if (Number.isFinite(need) && elapsedDays >= need) ids.push(m.id)
    }

    // Fetch the contact's name so the feedback template can address the
    // customer ({{customer_name}}). The fulfillment-state row only carries
    // order_id/delivered_at, so without this the survey template renders a
    // blank name. One indexed read per due row.
    const { data: contactRow } = await admin
      .from('contacts')
      .select('name')
      .eq('id', contactId)
      .maybeSingle()
    const customerName = (contactRow as { name?: string | null } | null)?.name ?? ''

    let anyExecuted = false
    for (const automationId of ids) {
      const result = await runAutomationById({
        automationId,
        contactId,
        context: {
          vars: {
            customer_name: customerName,
            order_id: String(r.order_id),
            delivered_at: r.delivered_at,
          },
        },
      })
      if (result.executed) {
        dispatched++
        anyExecuted = true
      }
    }
    // Nothing actually fired (audience mismatch, automation inactive)
    // — release the claim so the next tick re-evaluates after the
    // merchant fixes the audience config.
    if (!anyExecuted) {
      await releaseClaim(r.shop_domain, r.order_id)
      skipped++
    }
  }

  return NextResponse.json({ processed: due.length, dispatched, skipped })
}
