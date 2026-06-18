import { NextResponse } from 'next/server'
import { serverError } from '@/lib/api/errors'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationById } from '@/lib/automations/engine'
import { pingCron } from '@/lib/cron/heartbeat'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cron de re-engagement (recompras / clientes inactivos).
 *
 * Corre una vez por día. Multi-tenant: procesa TODOS los workspaces que
 * tienen al menos una automation activa con trigger_type='customer_inactive'
 * (más el workspace legacy de Pilar, que conserva el fallback por UUID
 * mientras migra). Para cada workspace busca contactos que cumplen:
 *
 *   - `opted_out = false`
 *   - `last_inbound_at < now() - interval 'N days'`   (silencio prolongado;
 *      N = el menor days_threshold de las automations activas, default 14)
 *   - `last_inbound_at IS NOT NULL`                    (alguna vez escribieron)
 *   - tienen al menos 1 pedido completado en Shopify (proxy: aparecen en
 *      automation_logs con trigger_event='shopify_order_created').
 *   - cooldown: la última fila de `contact_reengagement_state` para este
 *      contact es > 30 días atrás (o no existe)
 *
 * Para cada contacto dispara la(s) automation(s) cuyo days_threshold se
 * cumple y upsertea `contact_reengagement_state` con `last_reengagement_at
 * = now()`. Un fallo transitorio revierte el claim del cooldown.
 *
 * Antes esta cron estaba clavada a PILAR_WORKSPACE_ID, así que ningún otro
 * tenant recibía recompras aunque tuviera la automation activa. Ahora
 * itera por workspace para que funcione para cualquier usuario de Riverz.
 */
const DEFAULT_AUTOMATION_ID = '9a4c971b-7a36-48b3-be1e-cf2989b13918'
const PILAR_WORKSPACE_ID = '522a68ae-568d-4dd9-92e5-2c8f633f1761'
const DEFAULT_DAYS_THRESHOLD = 14
const COOLDOWN_DAYS = 30

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
  const legacyWorkspaceId = process.env.PILAR_WORKSPACE_ID || PILAR_WORKSPACE_ID

  const admin = supabaseAdmin()

  // Workspaces to process: cualquiera con una automation activa de tipo
  // customer_inactive + el workspace legacy (que usa el fallback por UUID).
  const { data: wsRows, error: wsErr } = await admin
    .from('automations')
    .select('workspace_id')
    .eq('trigger_type', 'customer_inactive')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (wsErr) return serverError(wsErr)

  const targets = new Set<string>()
  for (const r of (wsRows ?? []) as Array<{ workspace_id: string | null }>) {
    if (r.workspace_id) targets.add(r.workspace_id)
  }
  // Siempre incluimos el workspace legacy para conservar el fallback por
  // UUID mientras migra (aunque no tenga una automation por trigger_type).
  targets.add(legacyWorkspaceId)

  let processed = 0
  let dispatched = 0
  for (const wsId of targets) {
    try {
      const res = await processWorkspace(
        admin,
        wsId,
        wsId === legacyWorkspaceId ? legacyAutomationId : null,
      )
      processed += res.processed
      dispatched += res.dispatched
    } catch (err) {
      console.error('[cron/reengagement] workspace failed:', wsId, err)
    }
  }

  return NextResponse.json({ workspaces: targets.size, processed, dispatched })
}

/**
 * Procesa un workspace. `legacyAutomationId` es no-null sólo para el
 * workspace legacy de Pilar — para el resto, si no hay automations por
 * trigger_type simplemente no se dispara nada (no hay fallback cross-tenant).
 */
async function processWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  legacyAutomationId: string | null,
): Promise<{ processed: number; dispatched: number }> {
  // Automations activas de este workspace.
  const { data: candidateAutomations } = await admin
    .from('automations')
    .select('id, trigger_config')
    .eq('workspace_id', workspaceId)
    .eq('trigger_type', 'customer_inactive')
    .eq('is_active', true)
    .is('deleted_at', null)
  const automationsToFire = (candidateAutomations ?? []) as Array<{
    id: string
    trigger_config: { days_threshold?: number } | null
  }>

  // Sin automations propias y sin fallback legacy => nada que hacer.
  if (automationsToFire.length === 0 && !legacyAutomationId) {
    return { processed: 0, dispatched: 0 }
  }

  // El cutoff de silencio es el MENOR days_threshold configurado (así no nos
  // perdemos contactos que califican para la automation más agresiva).
  const minThreshold =
    automationsToFire.length > 0
      ? Math.min(
          ...automationsToFire.map((a) =>
            Number(a.trigger_config?.days_threshold ?? DEFAULT_DAYS_THRESHOLD),
          ),
        )
      : DEFAULT_DAYS_THRESHOLD
  const cutoff = new Date(
    Date.now() - minThreshold * 24 * 60 * 60 * 1000,
  ).toISOString()
  const cooldownAgo = new Date(
    Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  // Set de contact_ids que alguna vez tuvieron una orden (proxy via logs).
  const { data: orderLogs, error: ordersErr } = await admin
    .from('automation_logs')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('trigger_event', 'shopify_order_created')
    .not('contact_id', 'is', null)
  if (ordersErr) throw ordersErr
  const customerContactIds = new Set<string>()
  for (const row of (orderLogs ?? []) as Array<{ contact_id: string | null }>) {
    if (row.contact_id) customerContactIds.add(row.contact_id)
  }
  if (customerContactIds.size === 0) return { processed: 0, dispatched: 0 }

  // Contactos en silencio prolongado.
  const { data: candidates, error } = await admin
    .from('contacts')
    .select('id, name, phone, last_inbound_at')
    .eq('workspace_id', workspaceId)
    .eq('opted_out', false)
    .not('last_inbound_at', 'is', null)
    .lt('last_inbound_at', cutoff)
    .in('id', Array.from(customerContactIds))
    .order('last_inbound_at', { ascending: true })
    .limit(100)
  if (error) throw error
  if (!candidates || candidates.length === 0) return { processed: 0, dispatched: 0 }

  // Cooldown.
  const candidateIds = candidates.map((c) => (c as { id: string }).id)
  const { data: recentReengagements } = await admin
    .from('contact_reengagement_state')
    .select('contact_id, last_reengagement_at')
    .in('contact_id', candidateIds)
    .gt('last_reengagement_at', cooldownAgo)
  const cooldownSet = new Set<string>(
    ((recentReengagements ?? []) as Array<{ contact_id: string }>).map(
      (r) => r.contact_id,
    ),
  )

  let dispatched = 0
  for (const c of candidates) {
    const contact = c as {
      id: string
      name: string | null
      phone: string
      last_inbound_at: string | null
    }
    if (cooldownSet.has(contact.id)) continue

    const { data: priorState } = await admin
      .from('contact_reengagement_state')
      .select('last_reengagement_at, reengagement_count')
      .eq('contact_id', contact.id)
      .maybeSingle()

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

    const elapsedDays = contact.last_inbound_at
      ? (Date.now() - new Date(contact.last_inbound_at).getTime()) / 86_400_000
      : Number.POSITIVE_INFINITY

    const idsToFire: string[] = []
    if (automationsToFire.length > 0) {
      for (const a of automationsToFire) {
        const need = Number(
          a.trigger_config?.days_threshold ?? DEFAULT_DAYS_THRESHOLD,
        )
        if (Number.isFinite(need) && elapsedDays >= need) idsToFire.push(a.id)
      }
    } else if (legacyAutomationId) {
      idsToFire.push(legacyAutomationId)
    }

    let dispatchedHere = 0
    let anyTransientError = false
    for (const automationId of idsToFire) {
      const result = await runAutomationById({
        automationId,
        contactId: contact.id,
        context: { vars: { customer_name: contact.name ?? '' } },
      })
      if (result.executed) {
        dispatched++
        dispatchedHere++
      } else if ((result as { reason?: string }).reason === 'error') {
        anyTransientError = true
      }
    }

    // Rollback del cooldown sólo si nada se envió Y el fallo fue transitorio.
    if (anyTransientError && dispatchedHere === 0) {
      if (priorState) {
        await admin.from('contact_reengagement_state').upsert(
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

  return { processed: candidates.length, dispatched }
}
