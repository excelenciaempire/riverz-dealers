import { NextResponse } from 'next/server'
import { serverError } from '@/lib/api/errors'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationById } from '@/lib/automations/engine'
import { pingCron } from '@/lib/cron/heartbeat'

/**
 * Cron de re-engagement (Pilar).
 *
 * Corre una vez por día. Busca contactos del workspace que cumplen:
 *
 *   - `opted_out = false`
 *   - `last_inbound_at < now() - interval '14 days'`   (silencio prolongado)
 *   - `last_inbound_at IS NOT NULL`                    (alguna vez escribieron)
 *   - tienen al menos 1 pedido completado en Shopify
 *      (proxy: aparecen como customer_phone en shopify_checkouts con
 *       status='completed', o tienen una fila en automation_logs con
 *       trigger_event='shopify_order_created'). Usamos los logs porque
 *       no guardamos las órdenes completadas en una tabla propia: la
 *       trigger ya pasó por acá.
 *   - cooldown: la última fila de `contact_reengagement_state` para
 *     este contact es > 30 días atrás (o no existe)
 *
 * Para cada contacto dispara la automation "Re-engagement Pilar (14d
 * inactivo)" por ID y upsertea `contact_reengagement_state` con
 * `last_reengagement_at = now()`.
 *
 * Configurable via env `PILAR_REENGAGEMENT_AUTOMATION_ID` para que se
 * pueda swapear sin redeploy.
 *
 * Discovery v2: si existe alguna automation activa con
 * trigger_type='customer_inactive' en el workspace, usamos ESAS (puede
 * haber varias con distintos days_threshold). Si no, caemos al UUID
 * legacy hard-codeado para no romper a Pilar mientras migran.
 */
const DEFAULT_AUTOMATION_ID = '9a4c971b-7a36-48b3-be1e-cf2989b13918'
const PILAR_WORKSPACE_ID = '522a68ae-568d-4dd9-92e5-2c8f633f1761'
const DEFAULT_DAYS_THRESHOLD = 14

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }
  void pingCron('reengagement')

  const legacyAutomationId =
    process.env.PILAR_REENGAGEMENT_AUTOMATION_ID || DEFAULT_AUTOMATION_ID
  const workspaceId =
    process.env.PILAR_WORKSPACE_ID || PILAR_WORKSPACE_ID

  const admin = supabaseAdmin()
  const fourteenDaysAgo = new Date(
    Date.now() - DEFAULT_DAYS_THRESHOLD * 24 * 60 * 60 * 1000,
  ).toISOString()
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString()

  // Buscamos cualquier automation con trigger_type='customer_inactive'.
  // Si hay alguna, la usamos en lugar del UUID legacy.
  const { data: candidateAutomations } = await admin
    .from('automations')
    .select('id, trigger_config')
    .eq('workspace_id', workspaceId)
    .eq('trigger_type', 'customer_inactive')
    .eq('is_active', true)
  const automationsToFire = (candidateAutomations ?? []) as Array<{
    id: string
    trigger_config: { days_threshold?: number } | null
  }>

  // Paso 1: Set de contact_ids que alguna vez tuvieron una orden.
  // Buscamos en automation_logs por trigger_event = shopify_order_created.
  // Es una aproximación — un contacto que nunca disparó la automation
  // no aparece. Para Pilar esto sirve porque la automation existe desde
  // antes. Si necesitamos algo más preciso, una tabla
  // shopify_customer_orders sería el siguiente paso.
  const { data: orderLogs, error: ordersErr } = await admin
    .from('automation_logs')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('trigger_event', 'shopify_order_created')
    .not('contact_id', 'is', null)
  if (ordersErr) {
    return serverError(ordersErr)
  }
  const customerContactIds = new Set<string>()
  for (const row of (orderLogs ?? []) as Array<{ contact_id: string | null }>) {
    if (row.contact_id) customerContactIds.add(row.contact_id)
  }
  if (customerContactIds.size === 0) {
    return NextResponse.json({ processed: 0, reason: 'no_customers' })
  }

  // Paso 2: contactos del workspace que estuvieron 14 días en silencio.
  const { data: candidates, error } = await admin
    .from('contacts')
    .select('id, name, phone, last_inbound_at')
    .eq('workspace_id', workspaceId)
    .eq('opted_out', false)
    .not('last_inbound_at', 'is', null)
    .lt('last_inbound_at', fourteenDaysAgo)
    .in('id', Array.from(customerContactIds))
    .order('last_inbound_at', { ascending: true })
    .limit(100)

  if (error) return serverError(error)
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  // Paso 3: cooldown. Filtramos los que recibieron un re-engagement en
  // los últimos 30 días.
  const candidateIds = candidates.map((c) => (c as { id: string }).id)
  const { data: recentReengagements } = await admin
    .from('contact_reengagement_state')
    .select('contact_id, last_reengagement_at')
    .in('contact_id', candidateIds)
    .gt('last_reengagement_at', thirtyDaysAgo)
  const cooldownSet = new Set<string>(
    ((recentReengagements ?? []) as Array<{ contact_id: string }>).map(
      (r) => r.contact_id,
    ),
  )

  let dispatched = 0
  for (const c of candidates) {
    const contact = c as { id: string; name: string | null; phone: string }
    if (cooldownSet.has(contact.id)) continue

    // Snapshot prior state so a transient automation failure can
    // roll back the 30-day cooldown claim. Without this, a single
    // Meta/Supabase blip during dispatch would burn the cooldown
    // permanently and the contact would be silently locked out for 30d.
    const { data: priorState } = await admin
      .from('contact_reengagement_state')
      .select('last_reengagement_at, reengagement_count')
      .eq('contact_id', contact.id)
      .maybeSingle()

    // Reclamamos via upsert. Si dos crons concurrentes intentan tocar el
    // mismo contact, el segundo upsert sobrescribe — pero igual decidió
    // disparar en base al mismo snapshot pre-cooldown así que no hay
    // doble envío real.
    const { error: claimErr } = await admin
      .from('contact_reengagement_state')
      .upsert(
        {
          contact_id: contact.id,
          workspace_id: workspaceId,
          last_reengagement_at: new Date().toISOString(),
          reengagement_count:
            ((priorState as { reengagement_count?: number } | null)
              ?.reengagement_count ?? 0) + 1,
        },
        { onConflict: 'contact_id' },
      )
    if (claimErr) {
      console.error('[cron/reengagement] claim failed:', contact.id, claimErr)
      continue
    }

    // Decide qué automations disparar. Si hay configuradas, usamos
    // todas las que cumplan su days_threshold (silencio del contacto
    // >= days_threshold). Si no, caemos al legacy single-ID.
    const lastInboundAt = (c as { last_inbound_at: string | null })
      .last_inbound_at
    const elapsedDays = lastInboundAt
      ? (Date.now() - new Date(lastInboundAt).getTime()) / 86_400_000
      : Number.POSITIVE_INFINITY

    const idsToFire: string[] = []
    if (automationsToFire.length > 0) {
      for (const a of automationsToFire) {
        const need = Number(
          a.trigger_config?.days_threshold ?? DEFAULT_DAYS_THRESHOLD,
        )
        if (Number.isFinite(need) && elapsedDays >= need) idsToFire.push(a.id)
      }
    } else {
      idsToFire.push(legacyAutomationId)
    }

    let dispatchedHere = 0
    let anyTransientError = false
    for (const automationId of idsToFire) {
      const result = await runAutomationById({
        automationId,
        contactId: contact.id,
        context: {
          vars: {
            customer_name: contact.name ?? '',
          },
        },
      })
      if (result.executed) {
        dispatched++
        dispatchedHere++
      } else if (
        (result as { reason?: string }).reason === 'error'
      ) {
        anyTransientError = true
      }
    }

    // Rollback only when nothing actually sent AND the failure was
    // transient (not segment_mismatch / inactive — those are deliberate
    // and shouldn't lift the cooldown). Restore the prior row if it
    // existed; otherwise delete the just-created claim.
    if (anyTransientError && dispatchedHere === 0) {
      if (priorState) {
        await admin
          .from('contact_reengagement_state')
          .upsert(
            {
              contact_id: contact.id,
              workspace_id: workspaceId,
              last_reengagement_at: (priorState as { last_reengagement_at: string })
                .last_reengagement_at,
              reengagement_count: (priorState as { reengagement_count: number })
                .reengagement_count,
            },
            { onConflict: 'contact_id' },
          )
      } else {
        await admin
          .from('contact_reengagement_state')
          .delete()
          .eq('contact_id', contact.id)
      }
    }
  }

  return NextResponse.json({ processed: candidates.length, dispatched })
}
