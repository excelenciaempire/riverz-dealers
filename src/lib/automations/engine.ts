import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  AssignConversationStepConfig,
  VoiceCallStepConfig,
  VoiceCallType,
  SetContextStepConfig,
} from '@/types'
import { supabaseAdmin } from './admin-client'
import { motorApagado } from '@/lib/workspaces/motor'
import {
  inferVoiceCallScenario,
  isVoiceCallScenario,
  voiceCallTypeForScenario,
} from '@/lib/voice/scenarios'
import { enqueueCall } from '@/lib/voice/queue'
import { blockerCodeFromReason, VOICE_BLOCKED_KEY } from '@/lib/voice/labels'
import { translate } from '@/lib/i18n/translate'
import { engineSendText, engineSendTemplate } from './meta-send'
import { sendVoiceNote } from '@/lib/voice-notes/service'
import type { SendReason } from '@/lib/outreach/send-gate'
import { createShortLink } from '@/lib/links/short-link'
import { cartProductUrl } from '@/lib/shopify/cart-product-url'
import {
  resolveButtonUrlFromVars,
  isButtonUrlVariable,
} from '@/lib/whatsapp/dynamic-links'
import {
  shouldAllowAutomationSend,
  automationSpeaksImmediately,
} from './recent-ai-guard'
import { resolveSegment } from '@/lib/segments/resolve'
import { consultarCompra } from '@/lib/commerce/purchased-since'
import {
  getActiveShopifyConnection,
  fetchOrderFinancialStatus,
} from '@/lib/attribution/shopify'
import { recentlyContacted } from '@/lib/outreach/cooldown'
import { shouldStopRunOnInbound } from './inbound-stop'
import type { ContactSegment } from '@/lib/segments/types'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import { assignedTemplateVariant, recordExperimentExposure } from './template-ab-attribution'
import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
}

export interface DispatchInput {
  workspaceId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
  /**
   * Saltear las automatizaciones que hablan al instante, dejando correr las
   * que esperan.
   *
   * Lo usa el webhook de pedidos cuando el asistente ya confirmó la compra
   * con sus propias palabras: la confirmación enlatada sobraría, pero el
   * recordatorio de transferencia —que habla recién a la hora y sólo si no
   * pagó— no tiene nada que ver y tiene que seguir su curso.
   */
  skipImmediateSenders?: boolean
}

/**
 * Fire all active automations matching the given trigger for a user.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const db = supabaseAdmin()

    // Una compra gana sobre el carrito. Cancelamos la espera de recuperación
    // antes de evaluar el pedido nuevo, para que el cron no alcance a mandar
    // un recordatorio entre ambos webhooks.
    if (input.triggerType === 'shopify_order_created' && input.contactId) {
      await cancelPendingByTrigger(db, input.workspaceId, input.contactId, 'shopify_abandoned_checkout')
    }

    // Motor apagado —suspendida por cobro, o esperando aprobación—: no
    // sale ni un mensaje más. Se corta acá arriba, antes de leer nada, para
    // que ningún camino nuevo se olvide de preguntarlo.
    if (await motorApagado(db, input.workspaceId)) return

    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('workspace_id', input.workspaceId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true)
      .is('deleted_at', null)

    if (error) {
      console.error('[automations] fetch failed:', error)
      return
    }
    if (!automations || automations.length === 0) return

    for (const automation of automations as Automation[]) {
      if (!triggerMatches(automation, input.context)) continue
      if (
        input.skipImmediateSenders &&
        (await automationSpeaksImmediately(automation.id))
      ) {
        continue
      }
      if (!(await audienceMatches(automation, input.contactId ?? null))) continue
      // Recent-AI guard: skip chat-style automations when the IA or a
      // human agent just talked to this contact. See recent-ai-guard.ts
      // for the trade-off rationale.
      const gate = await shouldAllowAutomationSend({
        automation,
        contactId: input.contactId ?? null,
        triggerType: input.triggerType,
      })
      if (!gate.allow) {
        console.log(
          '[automations] skipped by recent-ai-guard:',
          automation.id,
          gate.reason,
        )
        continue
      }
      try {
        await executeAutomation(automation, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/** Cancela secuencias configuradas para ceder el chat apenas el cliente responde. */
export async function cancelPendingAutomationsOnInbound(input: {
  workspaceId: string
  contactId: string
  conversationId: string
  messageText: string
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: pending } = await db
    .from('automation_pending_executions')
    .select('id, automation_id, log_id, context')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .eq('status', 'pending')
  if (!pending?.length) return
  const ids = [...new Set(pending.map((p) => String(p.automation_id)))]
  const { data: automations } = await db
    .from('automations')
    .select('id, trigger_config')
    .in('id', ids)
    .eq('workspace_id', input.workspaceId)
  const stops = new Map(
    (automations ?? [])
      .map((a) => [String(a.id), a.trigger_config as Record<string, unknown>]),
  )
  const target = pending.filter((p) => stops.has(String(p.automation_id)) &&
    shouldStopRunOnInbound(stops.get(String(p.automation_id)), p.context))
  if (!target.length) return
  await db.from('automation_pending_executions').update({ status: 'done' }).in('id', target.map((p) => p.id))
  for (const row of target) {
    if (row.log_id) {
      await appendResults(String(row.log_id), [{
        step_id: String(row.id), step_type: 'wait', status: 'skipped', detail: 'cancelled by inbound reply',
      }], 'partial', null)
    }
  }
  // Se conserva el último contexto de recuperación junto al chat y se asigna
  // sólo al asistente indicado. No tocamos `assigned_agent_id`: es propiedad
  // del equipo humano.
  const context = (target[target.length - 1].context as AutomationContext | null) ?? {}
  const trigger = stops.get(String(target[target.length - 1].automation_id)) ?? {}
  const agentId = String(trigger.handoff_ai_agent_id ?? context.vars?.handoff_ai_agent_id ?? '').trim()
  if (agentId) {
    await db.from('conversations').update({
      assigned_ai_agent_id: agentId,
      automation_context: { ...(context.vars ?? {}), inbound_text: input.messageText },
    }).eq('id', input.conversationId).eq('workspace_id', input.workspaceId)
  }
}

async function cancelPendingByTrigger(
  db: ReturnType<typeof supabaseAdmin>, workspaceId: string, contactId: string, triggerType: string,
): Promise<void> {
  const { data: automations } = await db.from('automations').select('id').eq('workspace_id', workspaceId).eq('trigger_type', triggerType)
  const ids = (automations ?? []).map((a) => a.id)
  if (ids.length) await db.from('automation_pending_executions').update({ status: 'done' }).eq('workspace_id', workspaceId).eq('contact_id', contactId).eq('status', 'pending').in('automation_id', ids)
}

/**
 * Run a specific automation by id against a contact. Used by crons
 * that already know which automation they want to fire (cart recovery,
 * post-delivery feedback, re-engagement) — bypasses the trigger-type
 * dispatcher so two automations with the same trigger_type don't both
 * fire when only one applies to the current contact.
 *
 * Still honors audience_segment_id and is_active so a paused
 * automation never sends from the cron.
 */
export async function runAutomationById(input: {
  automationId: string
  contactId: string
  context?: AutomationContext
}): Promise<{ executed: boolean; reason?: string }> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db
      .from('automations')
      .select('*')
      .eq('id', input.automationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error || !data) return { executed: false, reason: 'not_found' }
    const automation = data as Automation
    if (!automation.is_active) return { executed: false, reason: 'inactive' }
    if (!(await audienceMatches(automation, input.contactId))) {
      return { executed: false, reason: 'segment_mismatch' }
    }
    // Recent-AI guard for cron-dispatched automations (feedback,
    // re-engagement). A re-engagement nudge that lands minutes after
    // the IA already re-engaged the customer is the exact scenario
    // this guard exists for.
    const gate = await shouldAllowAutomationSend({
      automation,
      contactId: input.contactId,
      triggerType: automation.trigger_type,
    })
    if (!gate.allow) {
      return { executed: false, reason: gate.reason }
    }
    await executeAutomation(automation, {
      workspaceId: automation.workspace_id,
      triggerType: automation.trigger_type,
      contactId: input.contactId,
      context: input.context ?? {},
    })
    return { executed: true }
  } catch (err) {
    console.error('[automations] runAutomationById failed:', err)
    return { executed: false, reason: 'error' }
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  workspace_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single()

  if (error || !automation) {
    console.error('[automations] resume: missing automation', pending.automation_id, error)
    await markPending(pending.id, 'failed')
    return
  }

  try {
    const ownerUserId = await resolveWorkspaceOwnerUserId(
      db,
      (automation as Automation).workspace_id,
    )
    await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
      ownerUserId,
    })
    await markPending(pending.id, 'done')
    // A resumed wait can reach the end of a branch without writing another
    // result. Do not leave its original `partial` log as a false incident once
    // no pending child remains for this execution.
    await finalizeResumedLogIfSettled(pending.log_id)
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

/**
 * Wake a run parked on a `voice_call` step, now that the call has a result.
 *
 * Called once per call from `persistCallResult`, which already guarantees it
 * only fires on the FINAL state (a call still cycling through retries hasn't
 * finished, so the branch must not be taken yet).
 *
 * A no-op when nothing is waiting — most calls (manual, campaign, follow-up)
 * were never started by an automation.
 */
export async function resumeAfterVoiceCall(
  callIds: string | string[],
  vars: Record<string, unknown>,
): Promise<void> {
  try {
    const db = supabaseAdmin()
    // Se buscan VARIOS ids porque un reintento es una fila `voice_calls`
    // NUEVA: la corrida quedó estacionada sobre el id del PRIMER intento y
    // quien reporta el resultado es el último. Sin la cadena completa, la
    // reanudación no encontraba nada justo en el caso para el que existe
    // —"no contestó, volvé a intentar"— y el flujo dormía las 24 h del tope.
    const keys = (Array.isArray(callIds) ? callIds : [callIds]).filter(Boolean)
    if (keys.length === 0) return
    const { data: rows } = await db
      .from('automation_pending_executions')
      .select('*')
      .in('resume_key', keys)
      .eq('status', 'pending')
      .limit(1)
    const row = (rows ?? [])[0] as Record<string, unknown> | undefined
    if (!row) return

    // Same claim as the cron: only the writer that flips pending→running
    // proceeds, so the 24 h timeout sweep and this call can't both resume.
    const { data: claim } = await db
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id as string)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) return

    const stored = (row.context as AutomationContext) ?? {}
    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      workspace_id: (row.workspace_id ?? row.user_id) as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      // The real outcome replaces the "no contestó" placeholders seeded when
      // the run parked.
      context: { ...stored, vars: { ...(stored.vars ?? {}), ...vars } },
    })
  } catch (err) {
    console.error('[automations] resumeAfterVoiceCall failed:', callIds, err)
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const db = supabaseAdmin()

  // Belt-and-suspenders: migration 053 makes automation_logs.user_id
  // nullable so cron-dispatched runs don't blow up at INSERT, but
  // when we *can* resolve a user (from the workspace owner) we still
  // backfill it so RLS-by-user policies and the per-user dashboard
  // queries continue to work. The lookup is one indexed read.
  const ownerUserId = await resolveWorkspaceOwnerUserId(
    db,
    automation.workspace_id,
  )

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      workspace_id: automation.workspace_id,
      user_id: ownerUserId,
      contact_id: input.contactId ?? null,
      trigger_event: input.triggerType,
      steps_executed: [],
      status: 'success',
    })
    .select()
    .single()

  if (logErr || !log) {
    console.error('[automations] cannot create log:', logErr)
    return
  }

  await executeStepsFrom({
    automation,
    contactId: input.contactId ?? null,
    context: input.context ?? {},
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId: log.id,
    triggerEvent: input.triggerType,
    ownerUserId,
  })

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
    p_automation_id: automation.id,
  })
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
}

/**
 * ¿Esta persona ya avisó que pagó?
 *
 * No es lo mismo que "está cobrado": es que lo dijo por chat y todavía nadie
 * lo confirmó en la tienda. Alcanza para callar los recordatorios, que es lo
 * único que se decide acá.
 */
async function avisoDePago(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  contactId: string | null,
): Promise<boolean> {
  if (!contactId) return false
  const { data } = await db
    .from('orders')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .not('payment_reported_at', 'is', null)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Qué clase de mensaje es, según lo que lo disparó.
 *
 * Un rescate sale a buscar una venta que no se cerró y por eso se enfría: no
 * se le insiste dos veces a la misma persona por lo mismo. Un aviso del
 * pedido no, y no es un detalle — el recordatorio de transferencia manda tres
 * mensajes en 24 h, así que enfriarlo lo mataría después del primero.
 */
function motivoDelDisparador(trigger: AutomationTriggerType): SendReason {
  return trigger === 'shopify_abandoned_checkout' ||
    trigger === 'payment_rejected' ||
    trigger === 'customer_inactive'
    ? 'rescate'
    : 'transaccional'
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
  /**
   * The workspace owner's auth.users.id. Passed to meta-send helpers
   * (which scope `contacts.user_id` / `whatsapp_config.user_id`).
   * Resolved once per executeAutomation call so we don't fan out one
   * `workspaces` lookup per step.
   */
  ownerUserId: string | null
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const db = supabaseAdmin()

  // Una corrida que dormía DENTRO de un camino y ya no sabe de cuál: el
  // camino se borró debajo suyo.
  //
  // Guardar la automatización borra todos los pasos y los reinserta
  // (`replaceSteps`), y la clave foránea de la fila dormida es ON DELETE SET
  // NULL, así que pierde el `parent_step_id` pero conserva el `branch` y la
  // posición. Sin este corte, "parent nulo" se lee como TRONCO y la corrida
  // reaparece en la posición 2 de la raíz: en el rescate de carrito eso es
  // volver a entrar por las barreras y mandarle la misma plantilla de nuevo a
  // alguien que ya la recibió hace dos días.
  if (args.parentStepId === null && args.branch !== null) {
    await finalizeLog(
      args.logId,
      'failed',
      'el camino donde esperaba ya no existe (la automatización se editó mientras tanto)',
    )
    return
  }

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true })

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery.eq('parent_step_id', args.parentStepId).eq('branch', args.branch ?? 'yes')

  const { data: steps, error: stepsErr } = await scoped

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
    return
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps as AutomationStep[]) {
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig
      const ms = waitMs(cfg)
      // `user_id` es NOT NULL en esta tabla (a diferencia de automation_logs,
      // que la 053 dejó nullable). Sin este campo el INSERT se caía en
      // silencio: el paso quedaba anotado como "esperando N minutos", nadie
      // encolaba la reanudación y el flujo se quedaba dormido para siempre en
      // "parcial" — el mensaje nunca salía.
      const { error: enqueueErr } = await db
        .from('automation_pending_executions')
        .insert({
          automation_id: args.automation.id,
          user_id:
            args.ownerUserId ??
            (args.automation as { user_id?: string | null }).user_id ??
            null,
          workspace_id: args.automation.workspace_id,
          contact_id: args.contactId,
          log_id: args.logId,
          parent_step_id: args.parentStepId,
          branch: args.branch,
          next_step_position: step.position + 1,
          context: args.context,
          run_at: new Date(Date.now() + ms).toISOString(),
          status: 'pending',
        })
      if (enqueueErr) {
        // Que se vea: una espera que no se encola no es una espera, es un
        // flujo cortado.
        console.error('[automations] no se pudo encolar la espera:', enqueueErr)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'failed',
          detail: enqueueErr.message,
        })
        await appendResults(args.logId, results, 'failed', enqueueErr.message)
        return
      }
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    // A call the run WAITS for is the second suspension point. Same
    // machinery as `wait`, with one difference: the row is also keyed by
    // the call id, so the finished call can wake it up long before run_at.
    // Without this the next step ran while the phone was still ringing.
    if (step.step_type === 'voice_call' && waitsForVoiceResult(step)) {
      let enqueued: { callId: string | null; detail: string }
      try {
        enqueued = await enqueueVoiceCallStep(step, args)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'failed',
          detail: msg,
        })
        await appendResults(args.logId, results, 'failed', msg)
        return
      }

      // Nothing to wait for (kill switch, opt-out, no phone, agent paused).
      // Se sigue INLINE en vez de quedarse esperando para siempre, con
      // `not_placed`: nadie marcó, así que la rama «no contestó» no es la que
      // corresponde.
      if (!enqueued.callId) {
        args.context.vars = { ...(args.context.vars ?? {}), ...VOICE_CALL_NOT_PLACED_VARS }
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'success',
          detail: enqueued.detail,
        })
        continue
      }

      const parkedContext: AutomationContext = {
        ...args.context,
        vars: { ...(args.context.vars ?? {}), ...VOICE_CALL_PENDING_VARS },
      }
      const { error: parkErr } = await db
        .from('automation_pending_executions')
        .insert({
          automation_id: args.automation.id,
          user_id:
            args.ownerUserId ??
            (args.automation as { user_id?: string | null }).user_id ??
            null,
          workspace_id: args.automation.workspace_id,
          contact_id: args.contactId,
          log_id: args.logId,
          parent_step_id: args.parentStepId,
          branch: args.branch,
          next_step_position: step.position + 1,
          context: parkedContext,
          resume_key: enqueued.callId,
          run_at: new Date(Date.now() + VOICE_CALL_WAIT_TIMEOUT_MS).toISOString(),
          status: 'pending',
        })
      if (parkErr) {
        // The call is already dialing; we just can't branch on it. Say so and
        // keep going instead of dropping the rest of the automation.
        console.error('[automations] no se pudo esperar la llamada:', parkErr)
        args.context.vars = { ...(args.context.vars ?? {}), ...VOICE_CALL_PENDING_VARS }
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'failed',
          detail: `${enqueued.detail} — sin espera: ${parkErr.message}`,
        })
        status = 'partial'
        continue
      }

      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `${enqueued.detail} — esperando el resultado`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        continue
      }

      const detail = await runStep(step, args)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage)
  }
}

/**
 * El envío no salió: corta el camino en vez de seguir como si hubiera salido.
 *
 * `engineSendTemplate` devuelve id vacío cuando una barrera lo frenó —la baja
 * del cliente, el cupo de la WABA, el corte de Marketing a EE.UU.— y no lanza,
 * a propósito: el motivo ya quedó escrito en el mensaje fallido y tumbar la
 * corrida entera sería peor. Pero los pasos que siguen SÍ dan por hecho que el
 * cliente recibió algo. En el rescate de carrito eso significa esperar dos días
 * y etiquetar "carrito-recuperado" a alguien que nunca leyó un mensaje nuestro:
 * la métrica se cuelga una venta que no provocó.
 *
 * Lanzar corta el camino donde está, deja el motivo en el registro y no toca
 * nada más de la automatización.
 */
function exigirQueHayaSalido(): never {
  throw new Error('el mensaje no salió (una barrera lo frenó): no se sigue el camino')
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  const db = supabaseAdmin()

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      if (cfg.voice_note) {
        const conversationId = await resolveVoiceConversationId(args)
        const result = await sendVoiceNote({ workspaceId: args.automation.workspace_id, conversationId,
          config: cfg.voice_note, variables: { ...args.context.vars, 'message.text': args.context.message_text },
          origin: 'automation', originName: args.automation.name, reason: motivoDelDisparador(args.automation.trigger_type),
        })
        return `sent voice note (${result.externalMessageId})`
      }
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        workspaceId: args.automation.workspace_id,
        conversationId,
        contactId: args.contactId,
        text,
        automationName: args.automation.name,
        reason: motivoDelDisparador(args.automation.trigger_type),
      })
      if (!whatsapp_message_id) exigirQueHayaSalido()
      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const configured = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      const variant = await assignedTemplateVariant(db, configured, {
        workspaceId: args.automation.workspace_id,
        automationId: args.automation.id,
        contactId: args.contactId,
      })
      // The selected variant becomes the normal send configuration. This keeps
      // dynamic-link and variable resolution identical to regular templates.
      const cfg: SendTemplateStepConfig = variant
        ? { template_name: variant.template_name, language: variant.language, variables: variant.variables }
        : configured
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)

      // Enriquecer el contexto con los datos del cliente para que las variables
      // "Correo/Teléfono/Nombre del cliente" se resuelvan en cualquier
      // disparador (el webhook de Shopify no siempre los trae). No pisamos un
      // valor que el disparador ya haya puesto.
      {
        const { data: c } = await db
          .from('contacts')
          .select('name, email, phone, last_product')
          .eq('id', args.contactId)
          .maybeSingle()
        if (c) {
          const vars = (args.context.vars ??= {})
          const full = String(c.name ?? '').trim()
          const [first, ...rest] = full.split(/\s+/)
          const setIfAbsent = (k: string, v: string) => {
            if (v && !(k in vars)) vars[k] = v
          }
          setIfAbsent('customer_name', full)
          setIfAbsent('contact_first_name', first ?? '')
          setIfAbsent('contact_last_name', rest.join(' '))
          setIfAbsent('contact_email', String(c.email ?? ''))
          setIfAbsent('contact_phone', String(c.phone ?? ''))
          setIfAbsent('last_product', String(c.last_product ?? ''))
        }
      }
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            // Each variable value may itself contain {{vars.x}} /
            // {{message.text}} placeholders (e.g. a "Nuevo pedido"
            // template mapping {{1}} → "{{vars.customer_name}}"). Run it
            // through interpolate() — same as send_message's text — so the
            // Shopify/cron context vars actually land in the Meta params
            // instead of the literal "{{vars.customer_name}}" string.
            .map((k) => interpolate(String(cfg.variables![k]), args))
        : []

      // Botón URL DINÁMICO: si la plantilla tiene un botón con `url_variable`,
      // resolvemos el link real de ESTE cliente desde el contexto del disparador
      // (p. ej. checkout_url del carrito abandonado), creamos un short link y
      // pasamos su token para llenar {{1}}. Sin esto, Meta rechaza el envío por
      // falta del parámetro del botón.
      let buttonUrlParam: string | undefined
      let buttonUrlIndex: number | undefined
      const tplQuery = db
        .from('message_templates')
        .select('buttons')
        .eq('workspace_id', args.automation.workspace_id)
        .eq('name', cfg.template_name)
      if (cfg.language) tplQuery.eq('language', cfg.language)
      const { data: tplRow } = await tplQuery.limit(1).maybeSingle()
      const tplButtons = (tplRow?.buttons as Array<Record<string, unknown>> | null) ?? []
      const dynIdx = tplButtons.findIndex(
        (b) => b?.type === 'URL' && isButtonUrlVariable(b?.url_variable),
      )
      if (dynIdx >= 0) {
        const urlVar = tplButtons[dynIdx].url_variable
        if (isButtonUrlVariable(urlVar)) {
          const target = resolveButtonUrlFromVars(urlVar, args.context.vars)
            || (urlVar === 'product' ? await cartProductUrl(
              db, args.automation.workspace_id,
              resolveButtonUrlFromVars('abandoned_checkout', args.context.vars) ?? '',
            ) : null)
          if (!target) {
            throw new Error(
              `send_template: falta el link para el botón dinámico (${urlVar}) — no llegó en el contexto`,
            )
          }
          buttonUrlParam = await createShortLink(db, {
            workspaceId: args.automation.workspace_id,
            targetUrl: target,
            contactId: args.contactId,
          })
          buttonUrlIndex = dynIdx
        }
      }

      // Keep the reply context even after the last reminder (no pending wait).
      // Human assignment is intentionally untouched.
      const handoffId = String((args.automation.trigger_config as Record<string, unknown>)?.handoff_ai_agent_id ?? '').trim()
      if (handoffId) {
        const { error } = await db.from('conversations').update({
          assigned_ai_agent_id: handoffId,
          automation_context: args.context.vars ?? {},
        }).eq('id', conversationId).eq('workspace_id', args.automation.workspace_id)
        if (error) throw new Error(`automation reply context: ${error.message}`)
      }
      const { whatsapp_message_id } = await engineSendTemplate({
        workspaceId: args.automation.workspace_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
        buttonUrlParam,
        buttonUrlIndex,
        automationName: args.automation.name,
        reason: motivoDelDisparador(args.automation.trigger_type),
        // Los seguimientos de una misma secuencia pueden tener una cadencia
        // menor al enfriamiento general de rescates. El override vive en el
        // paso para que no relaje la protección de ninguna otra automatización;
        // las bajas, los cupos y la ventana de Meta se siguen evaluando.
        cooldownHours: configured.cooldown_hours,
      })
      if (!whatsapp_message_id) exigirQueHayaSalido()
      if (variant && configured.ab_test) {
        await recordExperimentExposure(db, {
          workspaceId: args.automation.workspace_id,
          automationId: args.automation.id,
          stepId: step.id,
          logId: args.logId,
          contactId: args.contactId,
          experimentId: configured.ab_test.id,
          variantId: variant.id,
          templateName: cfg.template_name,
          whatsappMessageId: whatsapp_message_id,
        })
      }
      return `template sent via Meta (${whatsapp_message_id})${variant ? ` [A/B ${variant.id.toUpperCase()}]` : ''}`
    }

    case 'set_context': {
      const cfg = step.step_config as SetContextStepConfig
      args.context.vars = { ...(args.context.vars ?? {}), ...(cfg.values ?? {}) }
      return 'context stored'
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .upsert(
          { contact_id: args.contactId, tag_id: cfg.tag_id },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        )
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id)
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        // Antes era `.limit(1)`: "round robin" que devolvía SIEMPRE a la
        // misma persona. Ahora repartimos de verdad — gana quien tenga
        // menos conversaciones abiertas asignadas; con empate, el orden
        // estable por user_id evita que dos disparos simultáneos elijan
        // al mismo.
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('workspace_id', args.automation.workspace_id)
          .order('user_id', { ascending: true })
        const members = ((profiles ?? []) as { user_id: string }[]).map((p) => p.user_id)
        if (members.length) {
          const { data: openConvs } = await db
            .from('conversations')
            .select('assigned_agent_id')
            .eq('workspace_id', args.automation.workspace_id)
            .neq('status', 'closed')
            .is('deleted_at', null)
            .not('assigned_agent_id', 'is', null)
          const load = new Map<string, number>(members.map((m) => [m, 0]))
          for (const c of (openConvs ?? []) as { assigned_agent_id: string }[]) {
            if (load.has(c.assigned_agent_id)) {
              load.set(c.assigned_agent_id, (load.get(c.assigned_agent_id) ?? 0) + 1)
            }
          }
          agentId = members.reduce((best, m) =>
            (load.get(m) ?? 0) < (load.get(best) ?? 0) ? m : best,
          )
        }
      }
      if (!agentId) return 'no agent resolved'
      // Asignar por CONTACTO tocaba todas sus conversaciones: asignar en
      // WhatsApp apagaba la IA también en Instagram, Messenger y correo
      // (con el default reply_when_assigned=false). Se asigna sólo el hilo
      // en curso; sin él, el más reciente del contacto.
      let targetConvId = args.context.conversation_id ?? null
      if (!targetConvId) {
        const { data: recent } = await db
          .from('conversations')
          .select('id')
          .eq('workspace_id', args.automation.workspace_id)
          .eq('contact_id', args.contactId)
          .is('deleted_at', null)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
        targetConvId = (recent as { id?: string } | null)?.id ?? null
      }
      if (!targetConvId) return 'no conversation to assign'
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('id', targetConvId)
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      await db
        .from('contacts')
        .update({ [cfg.field]: cfg.value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
      return `${cfg.field} updated`
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'voice_call': {
      const outcome = await enqueueVoiceCallStep(step, args)
      return outcome.detail
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      // closed_at is the canonical "resolved at" timestamp the
      // dashboard reads — bumping it inline so "Resueltas hoy" stays
      // accurate without depending on the updated_at trigger (which
      // also fires on unrelated edits).
      const now = new Date().toISOString()
      await db
        .from('conversations')
        .update({ status: 'closed', closed_at: now, updated_at: now })
        .eq('workspace_id', args.automation.workspace_id)
        .eq('contact_id', args.contactId)
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveVoiceConversationId(args: ExecuteArgs): Promise<string> {
  if (args.context.conversation_id) return args.context.conversation_id
  const db = supabaseAdmin()
  const { data: contact } = await db.from('contacts').select('channel')
    .eq('workspace_id', args.automation.workspace_id).eq('id', args.contactId).maybeSingle()
  if (!contact) throw new Error('voiceNotes.conversationMissing')
  const { data, error } = await db.from('conversations').select('id')
    .eq('workspace_id', args.automation.workspace_id).eq('contact_id', args.contactId)
    .eq('channel', contact.channel).is('deleted_at', null)
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) throw new Error('voiceNotes.conversationMissing')
  return data.id
}

async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', args.automation.workspace_id)
    .eq('contact_id', args.contactId)
    // El mensaje sale por WhatsApp (ver el INSERT de abajo, que crea el hilo
    // con channel='whatsapp'), pero la búsqueda no filtraba por canal: si el
    // contacto tenía un hilo MÁS VIEJO de Instagram, Gmail o Mercado Libre,
    // la plantilla de WhatsApp se colgaba de esa conversación equivocada.
    .eq('channel', 'whatsapp')
    // Soft-delete (migración 085): don't resolve to a thread deleted from the
    // bandeja — the automation reply would vanish into an invisible row. Skip
    // it so we reuse a live thread or create a fresh visible one below.
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (data?.id) return data.id as string

  // No conversation yet. This is the COMMON case for Shopify automations:
  // a customer who placed an order (or abandoned a cart) but never messaged
  // us has no WhatsApp conversation. Throwing here made every order
  // confirmation / tracking / recovery message fail for first-time
  // customers. Create the conversation so the template has somewhere to
  // land and the thread shows up in the unified inbox.
  let connectionId: string | null = null
  const { data: conn } = await db
    .from('channel_connections')
    .select('id')
    .eq('workspace_id', args.automation.workspace_id)
    .eq('channel', 'whatsapp')
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  connectionId = (conn as { id?: string } | null)?.id ?? null

  const { data: created, error: insErr } = await db
    .from('conversations')
    .insert({
      user_id: args.ownerUserId,
      workspace_id: args.automation.workspace_id,
      contact_id: args.contactId,
      channel: 'whatsapp',
      connection_id: connectionId,
      status: 'open',
    })
    .select('id')
    .single()
  if (!insErr && created?.id) return created.id as string

  // Race: a concurrent dispatch (or the inbound webhook) created it between
  // our SELECT and INSERT. Unique index (migration 035) rejects the second
  // INSERT with 23505 — re-select the winner instead of failing the send.
  if ((insErr as { code?: string } | null)?.code === '23505') {
    const { data: winner } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', args.automation.workspace_id)
      .eq('contact_id', args.contactId)
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (winner?.id) return winner.id as string
  }
  throw new Error(`could not create conversation: ${insErr?.message ?? 'unknown'}`)
}

/**
 * If the automation is scoped to a segment, fire only when the
 * contact matches the segment's current rules. Triggers without a
 * contact (eg. time_based without a per-contact dispatch) can't be
 * scoped — we fail closed in that case so the user notices.
 */
async function audienceMatches(automation: Automation, contactId: string | null): Promise<boolean> {
  const segmentId = automation.audience_segment_id
  if (!segmentId) return true
  if (!contactId) return false
  return isContactInSegment(supabaseAdmin(), segmentId, contactId)
}

async function isContactInSegment(
  db: SupabaseClient,
  segmentId: string,
  contactId: string,
): Promise<boolean> {
  const { data: seg } = await db
    .from('contact_segments')
    .select('*')
    .eq('id', segmentId)
    .maybeSingle()
  if (!seg) return false
  const s = seg as ContactSegment
  try {
    const { contacts } = await resolveSegment(
      db,
      s.workspace_id,
      s.rules ?? [],
      s.match_mode,
    )
    return contacts.some((c) => c.id === contactId)
  } catch (err) {
    console.error('[automations] segment resolve failed:', err)
    return false
  }
}

/**
 * Enqueue the call a `voice_call` step asks for.
 *
 * Split out of `runStep` because the step is BOTH a normal action (legacy
 * fire-and-forget nodes) and a suspension point (nodes that wait for the
 * result): the loop needs the call id to park the run on, and `runStep` only
 * hands back a log line.
 */
async function enqueueVoiceCallStep(
  step: AutomationStep,
  args: ExecuteArgs,
): Promise<{ callId: string | null; detail: string }> {
  const cfg = step.step_config as VoiceCallStepConfig
  if (!args.contactId) throw new Error('voice_call needs a contact')
  if (!cfg.agent_id) throw new Error('voice_call needs agent_id')
  // Anti-loop: a call started FROM a voice_call_completed trigger must
  // not enqueue another call, or an unanswered → call → unanswered chain
  // would never end.
  if (args.automation.trigger_type === 'voice_call_completed') {
    return {
      callId: null,
      detail: 'voice_call skipped (would loop on voice_call_completed)',
    }
  }
  const inferredScenario = cfg.call_type
    ? null
    : inferVoiceCallScenario(
        args.automation.trigger_type,
        (args.context.vars ?? {}) as Record<string, unknown>,
      )
  const scenario = isVoiceCallScenario(cfg.scenario) ? cfg.scenario : inferredScenario
  const callType: VoiceCallType = scenario
    ? voiceCallTypeForScenario(scenario)
    : cfg.call_type ?? defaultVoiceCallType(args.automation.trigger_type)
  // Surface the trigger's accumulated vars (order/cart payload) to the
  // agent as call context, plus any one-off objective override.
  const context: Record<string, unknown> = { ...(args.context.vars ?? {}) }
  if (scenario) context.voice_scenario = scenario
  if (cfg.objective_override) context.objective_override = cfg.objective_override
  const result = await enqueueCall({
    workspaceId: args.automation.workspace_id,
    agentId: cfg.agent_id,
    contactId: args.contactId,
    callType,
    automationId: args.automation.id,
    context,
    origin: 'automation',
    sourceConversationId: args.context.conversation_id,
    maxAttempts: cfg.max_attempts,
    // Una automatización que llama y no llama es lo más caro de diagnosticar:
    // deja la fila con el motivo para que se vea en el registro de llamadas.
    recordSkip: true,
  })
  if (!result.enqueued) {
    // El detalle lo lee una persona en el historial de la corrida, no un log:
    // «kill_switch» no le dice a nadie que hay un interruptor esperando.
    const porQue = translate('es', VOICE_BLOCKED_KEY[blockerCodeFromReason(result.reason)])
    return { callId: null, detail: `No se llamó. ${porQue}` }
  }
  return { callId: result.callId, detail: `voice_call queued (${result.callId})` }
}

/**
 * Does this step park the run until the call ends?
 *
 * Siempre, salvo que el nodo diga `false` explícito. Era un interruptor en la
 * tarjeta, y su posición de apagado significaba "seguí con los pasos
 * siguientes mientras el teléfono todavía suena": nadie quiere eso, y era la
 * única forma de que la rama «si no contesta» no funcionara. Los nodos viejos
 * que lo tengan guardado en `false` conservan su forma; todo lo demás espera.
 */
function waitsForVoiceResult(step: AutomationStep): boolean {
  return (step.step_config as VoiceCallStepConfig)?.wait_for_result !== false
}

/**
 * How long a parked call run waits before giving up and continuing down the
 * "no contestó" path. Generous on purpose: it has to outlast every retry the
 * agent may schedule (default 2 attempts, 2 h apart). The cron that sweeps
 * stuck calls at 20 min is what normally ends a call, so this is a net, not
 * the usual path.
 */
const VOICE_CALL_WAIT_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * Result vars seeded when the run parks. If the call never reports back and
 * the timeout fires, the automation resumes with these — so an unanswered
 * call and a lost call take the same ("no contestó") path instead of hitting
 * an undefined variable. A real result overwrites them.
 */
const VOICE_CALL_PENDING_VARS: Record<string, unknown> = {
  call_status: 'no_answer',
  call_outcome: 'no_outcome',
  call_duration: 0,
  call_summary: '',
}

/**
 * Variables cuando la llamada NUNCA se hizo: una barrera la frenó (freno de
 * emergencia, agente sin voz, contacto dado de baja) y no sonó ningún
 * teléfono.
 *
 * Antes esto seguía con `call_status: 'no_answer'`, así que la rama del
 * comercio decía «no contestó» sobre un cliente al que nadie llamó. Son dos
 * cosas distintas y ahora se pueden separar en el lienzo.
 */
const VOICE_CALL_NOT_PLACED_VARS: Record<string, unknown> = {
  ...VOICE_CALL_PENDING_VARS,
  call_status: 'not_placed',
}

/** Map a trigger to the sensible voice call script when the step omits it. */
function defaultVoiceCallType(trigger: AutomationTriggerType): VoiceCallType {
  switch (trigger) {
    case 'shopify_order_created':
    case 'shopify_order_paid':
      return 'order_confirmation'
    case 'shopify_abandoned_checkout':
      return 'cart_recovery'
    case 'customer_inactive':
    case 'post_delivery_feedback':
      return 'followup'
    default:
      return 'manual'
  }
}

function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  // Filtro de plataforma para los activadores de tienda. Ausente o vacío =
  // todas, que es como se comportaban antes de que existiera el filtro: una
  // automatización vieja no puede dejar de dispararse porque agregamos una
  // opción nueva.
  const plataformas = (automation.trigger_config as { platforms?: unknown } | null)
    ?.platforms
  if (Array.isArray(plataformas) && plataformas.length > 0) {
    const dePedido = String(ctx?.vars?.platform ?? '').trim()
    // Sin plataforma en el contexto no filtramos: el activador puede venir de
    // un camino que no la informa (un cron viejo) y callar sería peor.
    if (dePedido && !plataformas.includes(dePedido)) return false
  }

  if (automation.trigger_type !== 'keyword_match') return true
  const cfg = automation.trigger_config as KeywordMatchTriggerConfig
  if (!cfg?.keywords || cfg.keywords.length === 0) return false
  const text = (ctx?.message_text ?? '').toString()
  if (!text) return false
  const haystack = cfg.case_sensitive ? text : text.toLowerCase()
  return cfg.keywords.some((raw) => {
    const k = cfg.case_sensitive ? raw : raw.toLowerCase()
    return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
  })
}

/**
 * Compare an actual value against a condition's value(s) using `cfg.op`
 * (default 'eq' = string equality). Numeric ops coerce both sides to numbers
 * so the "Bifurcar según…" node can branch on units >= 4, between 2 and 3, etc.
 */
function matchesValue(actual: unknown, cfg: ConditionStepConfig): boolean {
  if (actual == null) return false
  const op = cfg.op ?? 'eq'
  // Comparación de igualdad tolerante: trim + minúsculas. Las ofertas se
  // guardan con casing variable (la del sitio vs la manual: "2 Unidades + 1
  // GRATIS" vs "2 unidades + 1 gratis"), y estados como 'paid' son
  // consistentes igual — así el camino elegido matchea aunque cambie el casing.
  if (op === 'eq') {
    return (
      String(actual).trim().toLowerCase() ===
      String(cfg.value ?? '').trim().toLowerCase()
    )
  }
  const a = Number(actual)
  const b = Number(cfg.value)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  switch (op) {
    case 'gt':
      return a > b
    case 'gte':
      return a >= b
    case 'lt':
      return a < b
    case 'lte':
      return a <= b
    case 'between': {
      const c = Number(cfg.value2)
      if (!Number.isFinite(c)) return false
      return a >= Math.min(b, c) && a <= Math.max(b, c)
    }
    default:
      return false
  }
}

/**
 * Desde cuándo mira una condición temporal.
 *
 * `since_trigger` es el default y el que tiene sentido casi siempre: mide
 * desde que ESTE flujo arrancó. Puesto después de una espera, contesta "y
 * mientras esperábamos, ¿pasó algo?" sin que nadie tenga que repetir la
 * duración de la espera — que es la forma de que las dos se desincronicen en
 * silencio el día que alguien cambia una y olvida la otra.
 *
 * Una duración explícita ("3h", "7d") sigue disponible para cuando la
 * pregunta no es sobre la espera sino sobre un periodo propio.
 */
async function windowStart(
  db: ReturnType<typeof supabaseAdmin>,
  operand: string | undefined,
  logId: string | null,
): Promise<string> {
  // "Alguna vez": sin límite hacia atrás. Sin este caso, `windowMs` no
  // reconocía "ever" y devolvía su default de 24 h, así que la condición
  // contestaba por el último día creyendo contestar por el histórico — mal,
  // y en silencio.
  if (operand === 'ever') return new Date(0).toISOString()

  if (!operand || operand === 'since_trigger') {
    if (!logId) return new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { data } = await db
      .from('automation_logs')
      .select('created_at')
      .eq('id', logId)
      .maybeSingle()
    const started = (data as { created_at?: string } | null)?.created_at
    // Postgres la devuelve con espacio ("2026-08-14 19:10:01.33+00"); quien la
    // recibe la compara contra fechas de Shopify y se la manda a su API, y las
    // dos cosas piden ISO de verdad.
    const startedMs = started ? Date.parse(started) : NaN
    if (!Number.isNaN(startedMs)) return new Date(startedMs).toISOString()
    // Sin log no hay desde cuándo: se cae al día, que es el default viejo.
    return new Date(Date.now() - 24 * 3_600_000).toISOString()
  }
  return new Date(Date.now() - windowMs(operand)).toISOString()
}

/**
 * Ventana de una condición temporal: "3h", "7d", "45m". Por defecto 24h.
 *
 * Es la misma gramática corta en todos los pasos que miran hacia atrás, así
 * que un flujo se lee igual sin importar quién lo armó.
 */
function windowMs(operand: string | undefined): number {
  const m = /^\s*(\d+)\s*([mhd])\s*$/i.exec(operand ?? '')
  if (!m) return 24 * 3_600_000
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const factor = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return Math.min(Math.max(n, 1) * factor, 90 * 86_400_000)
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand)
      return (count ?? 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .maybeSingle()
      return matchesValue((data as Record<string, unknown> | null)?.[cfg.operand], cfg)
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'in_segment': {
      if (!args.contactId || !cfg.operand) return false
      return isContactInSegment(db, cfg.operand, args.contactId)
    }
    case 'context_var': {
      // Reads from context.vars, populated by the dispatching webhook
      // (e.g. shopify_order_created exposes offer_units, is_repeat_customer).
      if (!cfg.operand) return false
      return matchesValue(
        (args.context.vars as Record<string, unknown> | undefined)?.[cfg.operand],
        cfg,
      )
    }
    case 'purchased': {
      // Verdadero si la persona compró dentro de la ventana pedida. Se
      // consulta en vivo contra los pedidos de la tienda, no contra el
      // contexto capturado al disparar: puesto después de una espera,
      // responde "y mientras tanto, ¿compró?", que es el único momento en
      // que la pregunta significa algo.
      if (!args.contactId) return false

      // "Alguna vez" no se puede contestar con la API de pedidos: sólo
      // devuelve una ventana reciente. Para eso está la marca del contacto,
      // que es justamente el histórico. Antes esto era un dato aparte en el
      // selector ("Ya compró alguna vez") y convivía con éste: dos preguntas
      // de compra, una al lado de la otra, sin forma de saber cuál usar.
      if ((cfg.operand ?? '') === 'ever') {
        const { data: row } = await db
          .from('contacts')
          .select('is_shopify_customer')
          .eq('id', args.contactId)
          .maybeSingle()
        const ever = Boolean((row as { is_shopify_customer?: boolean } | null)?.is_shopify_customer)
        return ever === ((cfg.value ?? 'true').toLowerCase() !== 'false')
      }

      const since = await windowStart(db, cfg.operand, args.logId)
      const { data: c } = await db
        .from('contacts')
        .select('email, phone')
        .eq('id', args.contactId)
        .maybeSingle()
      const contact = c as { email: string | null; phone: string | null } | null
      const r = await consultarCompra(db, {
        workspaceId: args.automation.workspace_id,
        sinceIso: String(since),
        email: contact?.email,
        phone: contact?.phone,
      })
      // `value` permite invertirlo desde la UI: "compró = no" es la rama
      // que manda el mensaje.
      const want = (cfg.value ?? 'true').toLowerCase() !== 'false'

      if (r.estado === 'sin_respuesta') {
        // Shopify no contestó. Preguntando "¿NO compró?" —la barrera que
        // frena un mensaje— seguir de largo es lo prudente y es lo que se
        // hacía siempre: peor sería apagar la recuperación por una caída
        // ajena. Pero preguntando "¿SÍ compró?" —la atribución— responder
        // que no borra una venta recuperada de la medición para siempre, sin
        // dejar rastro. Ahí se corta con el error a la vista.
        if (want) throw new Error(`no se pudo consultar la compra: ${r.motivo}`)
        return true
      }
      return (r.estado === 'compro') === want
    }
    case 'messaged': {
      // ¿Ya le escribimos nosotros hace poco? Es la misma pregunta que hace
      // la barrera compartida antes de cualquier envío, pero acá vive como
      // paso del flujo: se ve en el lienzo y cada quien elige su ventana.
      if (!args.contactId) return false
      const from = await windowStart(db, cfg.operand, args.logId)
      const hit = await recentlyContacted(db, {
        workspaceId: args.automation.workspace_id,
        contactId: args.contactId,
        withinHours: Math.max(
          0.017,
          (Date.now() - new Date(from).getTime()) / 3_600_000,
        ),
      })
      return hit.blocked === ((cfg.value ?? 'true').toLowerCase() !== 'false')
    }
    case 'rejected_open': {
      // ¿Esta persona tiene un pago rechazado que todavía no se resolvió?
      //
      // Es el cruce entre los dos rescates. Un rechazo de tarjeta deja el
      // checkout abierto, así que la misma persona entra por los dos lados y
      // sin esta pregunta recibe "dejaste algo a medias" y "no pudimos
      // procesar tu pago" con minutos de diferencia. Gana el de pago: dice lo
      // que pasó de verdad.
      //
      // Se empareja por los últimos 8 dígitos del teléfono, que es lo único
      // que comparten un checkout de la tienda y un pago de la pasarela.
      if (!args.contactId) return false
      const { data: c } = await db
        .from('contacts')
        .select('phone')
        .eq('id', args.contactId)
        .maybeSingle()
      const phone = (c as { phone?: string | null } | null)?.phone ?? ''
      const digits = phone.replace(/\D/g, '')
      const want = (cfg.value ?? 'true').toLowerCase() !== 'false'
      if (digits.length < 8) return false === want
      const from = await windowStart(db, cfg.operand, args.logId)
      const { data: hit } = await db
        .from('mp_rejected_payments')
        .select('id')
        .eq('workspace_id', args.automation.workspace_id)
        .like('phone', `%${digits.slice(-8)}`)
        .gte('rejected_at', from)
        // Sin resolver: ni pagado después, ni descartado por otra razón.
        .is('paid_at', null)
        .is('skip_reason', null)
        .limit(1)
        .maybeSingle()
      return Boolean(hit) === want
    }
    case 'order_paid': {
      // ¿El pedido ya figura pagado? Se le pregunta a la tienda AHORA, no al
      // contexto: el webhook guardó el estado que el pedido tenía al crearse
      // y después de una espera ese dato no dice nada. Es la pregunta de los
      // pedidos por transferencia — el cliente paga horas después, y sin
      // volver a consultar el recordatorio le llega igual.
      const orderId = String((args.context?.vars ?? {}).order_id ?? '')
      const want = (cfg.value ?? 'true').toLowerCase() !== 'false'
      if (!orderId) return false
      const conn = await getActiveShopifyConnection(db, args.automation.workspace_id)
      if (!conn) return false
      const status = await fetchOrderFinancialStatus(conn, orderId)
      // Sin respuesta de la tienda no se afirma nada: la rama de "pagó" queda
      // sin cumplirse y el recordatorio no sale. Callar es más barato que
      // escribirle a quien ya pagó.
      if (status === null) return want
      // "Dijo que pagó" cuenta igual que "está pagado" para dejar de
      // insistir. Shopify puede tardar en enterarse —el comprobante llegó por
      // WhatsApp y todavía nadie lo confirmó— y mientras tanto seguir
      // mandando recordatorios es exactamente lo que hay que evitar. Dar por
      // COBRADO es otra decisión y vive en lib/payments/reported-payment.ts.
      const paid =
        status === 'paid' ||
        status === 'partially_paid' ||
        (await avisoDePago(db, args.automation.workspace_id, args.contactId))
      return paid === want
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : cfg.unit === 'minutes' ? 60_000 : 1_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  // Un paso mal configurado -sin texto- tumbaba la corrida entera con un
  // "Cannot read properties of undefined (reading 'replace')", que no le dice
  // nada a nadie y esconde cuál fue el paso. Vale más mandar vacío y que el
  // registro muestre el paso que falló.
  if (typeof s !== 'string') return ''
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single()
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { steps_executed: merged }
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.error_message = errorMessage
  await db.from('automation_logs').update(update).eq('id', logId)
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId)
}

async function markPending(id: string, status: 'done' | 'failed') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id)
}

async function finalizeResumedLogIfSettled(logId: string | null): Promise<void> {
  if (!logId) return
  const db = supabaseAdmin()
  const { count, error } = await db
    .from('automation_pending_executions')
    .select('id', { count: 'exact', head: true })
    .eq('log_id', logId)
    .in('status', ['pending', 'running'])
  if (!error && (count ?? 0) === 0) {
    await finalizeLog(logId, 'success', null)
  }
}

// `resolveWorkspaceOwnerUserId` lives in `@/lib/workspaces/owner` so
// the flows engine and any future provider helper can share the same
// lookup. See that module for the rationale.
