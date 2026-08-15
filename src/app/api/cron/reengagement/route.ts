import { NextResponse } from 'next/server'
import { serverError } from '@/lib/api/errors'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationById } from '@/lib/automations/engine'
import { withCronRun } from "@/lib/cron/heartbeat";
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
 * Es totalmente por-workspace: procesa cualquier tenant con una automation
 * activa de tipo customer_inactive, sin casos especiales ni fallbacks por
 * UUID.
 */
const DEFAULT_DAYS_THRESHOLD = 14
const COOLDOWN_DAYS = 30

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  // Workspaces to process: cualquiera con una automation activa de tipo
  // customer_inactive.
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

  let processed = 0
  let dispatched = 0
  for (const wsId of targets) {
    try {
      const res = await processWorkspace(admin, wsId)
      processed += res.processed
      dispatched += res.dispatched
    } catch (err) {
      console.error('[cron/reengagement] workspace failed:', wsId, err)
    }
  }

  return NextResponse.json({ workspaces: targets.size, processed, dispatched })
}

/**
 * Procesa un workspace. Si no hay automations activas por trigger_type
 * simplemente no se dispara nada — no hay fallback cross-tenant.
 */
async function processWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
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

  // Sin automations propias => nada que hacer.
  if (automationsToFire.length === 0) {
    return { processed: 0, dispatched: 0 }
  }

  // El cutoff de silencio es el MENOR days_threshold configurado (así no nos
  // perdemos contactos que califican para la automation más agresiva).
  const minThreshold = Math.min(
    ...automationsToFire.map((a) =>
      Number(a.trigger_config?.days_threshold ?? DEFAULT_DAYS_THRESHOLD),
    ),
  )
  const cutoff = new Date(
    Date.now() - minThreshold * 24 * 60 * 60 * 1000,
  ).toISOString()
  const cooldownAgo = new Date(
    Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  // Cuándo compró cada uno. El log del disparador es la mejor fecha de
  // compra que hay: los pedidos de Shopify no se espejan en `orders` (ahí
  // sólo viven los de Mercado Libre y los que arma la IA), así que la fila
  // que dejó `shopify_order_created` al ejecutarse es lo más cercano.
  const { data: orderLogs, error: ordersErr } = await admin
    .from('automation_logs')
    .select('contact_id, created_at')
    .eq('workspace_id', workspaceId)
    .eq('trigger_event', 'shopify_order_created')
    .not('contact_id', 'is', null)
  if (ordersErr) throw ordersErr
  const ultimaCompra = new Map<string, string>()
  for (const row of (orderLogs ?? []) as Array<{
    contact_id: string | null
    created_at: string
  }>) {
    if (!row.contact_id) continue
    const previa = ultimaCompra.get(row.contact_id)
    if (!previa || row.created_at > previa) ultimaCompra.set(row.contact_id, row.created_at)
  }
  if (ultimaCompra.size === 0) return { processed: 0, dispatched: 0 }

  // La receta promete "a los 45 días del último pedido" y eso es lo que se
  // mide. Antes se cortaba por `last_inbound_at` —los 45 días desde que el
  // cliente ESCRIBIÓ— y encima se exigía que hubiera escrito alguna vez, así
  // que quien compró y nunca contestó por WhatsApp no entraba nunca. En esta
  // cuenta son 2.146 personas: la mayoría de los compradores.
  const enVentana = [...ultimaCompra.entries()]
    .filter(([, cuando]) => cuando < cutoff)
    .map(([id]) => id)
  if (enVentana.length === 0) return { processed: 0, dispatched: 0 }

  const { data: candidates, error } = await admin
    .from('contacts')
    .select('id, name, phone, last_inbound_at')
    .eq('workspace_id', workspaceId)
    .eq('opted_out', false)
    .in('id', enVentana.slice(0, 500))
    .limit(100)
  if (error) throw error
  if (!candidates || candidates.length === 0) return { processed: 0, dispatched: 0 }

  // Quien está hablando con nosotros ahora no necesita que lo reactivemos:
  // el silencio sigue importando, pero como exclusión y no como requisito.
  const hablandoDesde = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
  const enConversacion = new Set(
    (candidates as Array<{ id: string; last_inbound_at: string | null }>)
      .filter((c) => c.last_inbound_at && c.last_inbound_at > hablandoDesde)
      .map((c) => c.id),
  )

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
    if (enConversacion.has(contact.id)) continue

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

    // Días desde la COMPRA, que es lo que dice la receta. Cada automatización
    // puede pedir su propio plazo, y acá se decide cuáles ya llegaron.
    const compra = ultimaCompra.get(contact.id)
    const elapsedDays = compra
      ? (Date.now() - new Date(compra).getTime()) / 86_400_000
      : Number.POSITIVE_INFINITY

    const idsToFire: string[] = []
    for (const a of automationsToFire) {
      const need = Number(
        a.trigger_config?.days_threshold ?? DEFAULT_DAYS_THRESHOLD,
      )
      if (Number.isFinite(need) && elapsedDays >= need) idsToFire.push(a.id)
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

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("reengagement", cronHandler);
