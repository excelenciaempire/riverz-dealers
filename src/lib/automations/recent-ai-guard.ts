import type { Automation, AutomationStep, AutomationTriggerType } from '@/types'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Recent-AI guard
// ------------------------------------------------------------
//
// Problem we are solving:
//
//   Pilar (la IA) just took an order via chat — "perfecto, te paso el
//   link de checkout, abre y paga 👇" — and 30 seconds later Shopify
//   webhook fires `orders/create`, which dispatches the "thank-you for
//   ordering" automation. The customer gets a stilted "¡Gracias por
//   tu compra!" template right on top of the human-feeling exchange
//   they just had, which makes the IA look like a robot copy of itself.
//
// What this module does:
//
//   For chat-style automations (those whose tree contains a
//   `send_message` step — i.e. they will TALK in the conversation),
//   we check whether the IA (or a human agent) sent a message to this
//   contact within the last 5 minutes. If so, we skip the send.
//
//   We deliberately do NOT defer the run — deferring a "thanks for
//   ordering" by 10 minutes still produces a robotic message that
//   shows up after the customer already moved on. Skipping is the
//   right call: the IA already covered the moment in human language.
//
//   Transactional triggers (order shipped, fulfilled, etc.) are
//   exempted because those messages carry information the customer
//   needs regardless of conversational context — a shipping
//   notification that doesn't arrive is worse than one that lands a
//   minute after the IA said "voy a procesar tu pedido".
//
// Trade-off (documented per Pilar's request):
//
//   A chatty automation that the customer would have liked to receive
//   anyway (eg. "te dejo nuestro Instagram") will silently no-op if
//   the IA was just talking. We considered tagging the automation
//   sends so the IA could explicitly check "was I just talking?" at
//   compose time — but that pushes the responsibility onto every IA
//   prompt, instead of centralizing it here. Keep this guard until
//   the IA gains explicit awareness of pending automations.
// ------------------------------------------------------------

/** Window during which a recent IA/agent send suppresses chatty automations. */
export const AI_RECENT_WINDOW_MS = 5 * 60 * 1000

/**
 * Trigger types that are always allowed to fire, even if the IA just
 * spoke. These carry information the customer relies on (shipping,
 * delivery confirmation) and would be worse to skip than to feel
 * slightly robotic.
 */
const TRANSACTIONAL_TRIGGERS: ReadonlySet<AutomationTriggerType> = new Set<AutomationTriggerType>([
  // Order shipped / tracking update — customer wants this regardless.
  'shopify_order_fulfilled',
  // Cart recovery is scheduled deliberately and only fires once per
  // checkout; if it lands near an IA message the IA was likely the one
  // who sent the checkout link, so it would feel even more robotic —
  // but the original spec calls these out as deliberate workflows.
  // Treat as transactional: the cart-recovery cron already gates on
  // recovery_dispatched_at and waits 2+ hours, so collisions are rare.
  'shopify_abandoned_checkout',
])

/**
 * @returns true when this trigger type should bypass the recent-AI
 *   guard. Use for transactional notifications (shipping, fulfillment)
 *   where missing the message is worse than sounding canned.
 */
export function isTransactionalTrigger(triggerType: AutomationTriggerType): boolean {
  return TRANSACTIONAL_TRIGGERS.has(triggerType)
}

/**
 * @returns true when the automation has at least one send step
 *   (`send_message` or `send_template`). Tag-only, webhook-only or
 *   assignment-only automations are silent from the customer's POV and
 *   never need the guard.
 */
export async function automationHasChatSteps(automationId: string): Promise<boolean> {
  const db = supabaseAdmin()
  const { count, error } = await db
    .from('automation_steps')
    .select('id', { count: 'exact', head: true })
    .eq('automation_id', automationId)
    .in('step_type', ['send_message', 'send_template'])
  if (error) {
    // Fail open — better to send than to silently drop everything if
    // the steps table is unreachable. The engine will still log the
    // attempt and any send failure surfaces in automation_logs.
    console.error('[automations] guard: cannot inspect steps:', error)
    return true
  }
  return (count ?? 0) > 0
}

/**
 * ¿Este flujo habla YA, o antes espera?
 *
 * La guardia existe para que un mensaje enlatado no aterrice arriba de una
 * conversación que la IA está teniendo en ese momento. Un flujo cuyo tronco
 * empieza con un paso `Esperar` no puede hacer eso: cuando hable van a haber
 * pasado horas, y la ventana de la guardia son cinco minutos.
 *
 * Ante la duda —o si la consulta falla— se responde que sí habla, que deja
 * la guardia como estaba.
 */
export async function automationSpeaksImmediately(automationId: string): Promise<boolean> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('automation_steps')
    .select('step_type, position, parent_step_id')
    .eq('automation_id', automationId)
  if (error) return true
  const steps = (data ?? []) as {
    step_type: string
    position: number
    parent_step_id: string | null
  }[]
  // Sin ninguna espera, habla apenas se dispara.
  if (!steps.some((s) => s.step_type === 'wait')) return true
  // Con espera: sólo habla ya si hay un envío en el tronco ANTES de la
  // primera espera del tronco. Los envíos que cuelgan de una condición
  // posterior a la espera llegan siempre después.
  const trunk = steps
    .filter((s) => s.parent_step_id === null)
    .sort((a, b) => a.position - b.position)
  for (const s of trunk) {
    if (s.step_type === 'wait') return false
    if (s.step_type === 'send_message' || s.step_type === 'send_template') return true
  }
  return false
}

/**
 * Same as `automationHasChatSteps` but accepts a pre-loaded steps
 * array (used by resume paths that already have them in memory).
 */
export function stepsContainChatSend(steps: Pick<AutomationStep, 'step_type'>[]): boolean {
  return steps.some((s) => s.step_type === 'send_message' || s.step_type === 'send_template')
}

/**
 * @returns true when the most recent outbound message to this contact
 *   (any conversation, any channel) was sent by the IA (`bot`) or a
 *   human agent (`agent`) within `withinMs`. We include `agent` too:
 *   if a human just replied, an automation message right after is even
 *   more jarring than after the IA.
 */
export async function wasAiOrAgentRecentlyActive(
  contactId: string,
  withinMs: number = AI_RECENT_WINDOW_MS,
): Promise<boolean> {
  const db = supabaseAdmin()
  const sinceIso = new Date(Date.now() - withinMs).toISOString()

  // Join through conversations to find any message for this contact.
  // We pick the latest non-customer message and check its timestamp;
  // doing it in two steps (last outbound, then compare) is simpler and
  // cheaper than a windowed SQL — Supabase doesn't let us do `max(...)
  // filter` from the client.
  const { data, error } = await db
    .from('messages')
    .select('created_at, sender_type, conversations!inner(contact_id)')
    .eq('conversations.contact_id', contactId)
    .in('sender_type', ['bot', 'agent'])
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    // Fail open: if we can't tell, don't block automations. Worst case
    // is the robotic-sounding message we were trying to avoid; best
    // case is we don't drop transactional-feeling messages on a DB
    // hiccup.
    console.error('[automations] guard: recent-message lookup failed:', error)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

/**
 * Top-level guard used by the dispatcher.
 *
 * @returns `{ allow: true }` when the automation may run, or
 *   `{ allow: false, reason }` when it should be silently skipped.
 *
 * Order of checks (cheapest first):
 *   1. No contact id — can't check messages, allow (broadcast-style).
 *   2. Trigger is transactional — allow regardless of IA activity.
 *   3. Automation has no chat-style send steps — allow (silent side
 *      effects only).
 *   4. IA or agent talked to this contact within the window — skip.
 */
export async function shouldAllowAutomationSend(args: {
  automation: Automation
  contactId: string | null
  triggerType: AutomationTriggerType
}): Promise<{ allow: true } | { allow: false; reason: string }> {
  if (!args.contactId) return { allow: true }
  if (isTransactionalTrigger(args.triggerType)) return { allow: true }
  const hasChatSteps = await automationHasChatSteps(args.automation.id)
  if (!hasChatSteps) return { allow: true }
  // Un flujo que arranca esperando no puede caerle encima a una conversación
  // viva: para cuando hable ya pasaron horas. Frenarlo acá era descartar el
  // recordatorio de transferencia entero —que habla recién a la hora— porque
  // la IA había pasado el link de pago dos minutos antes.
  if (!(await automationSpeaksImmediately(args.automation.id))) return { allow: true }
  const recent = await wasAiOrAgentRecentlyActive(args.contactId)
  if (recent) {
    return { allow: false, reason: 'ai_or_agent_active_within_5min' }
  }
  // Y el caso que los cinco minutos no cubren: una persona del equipo ya está
  // atendiendo a este cliente por lo mismo.
  //
  // Pasó el 2026-08-28 con María Cristina. Pagó por transferencia el día 27,
  // mandó el comprobante, una persona le contestó y le dijo entre qué días
  // salía. Al día siguiente el pedido entró a Shopify —lo cargaron después de
  // validar el pago— y el flujo "Nuevo pedido" le pidió el comprobante de
  // nuevo. Ella contestó "lo reenvié ayer, estoy esperando mi pedido". No fue
  // un mensaje repetido: fue el primero de ese flujo, cayendo veinte horas
  // tarde encima de una conversación que ya estaba resuelta.
  //
  // La ventana de cinco minutos está pensada para "la IA acaba de hablar".
  // Esto es otra cosa: hay alguien del equipo adentro del caso, y un mensaje
  // enlatado ahí no molesta, contradice.
  const atendida = await hayAlguienAtendiendo(args.contactId)
  if (atendida) {
    return { allow: false, reason: atendida }
  }
  return { allow: true }
}

/** Cuánto vale "una persona está atendiendo esto". Un día: si alguien del
 *  equipo contestó ayer, el caso sigue siendo suyo. */
const VENTANA_ATENDIDA_MS = 24 * 60 * 60 * 1000

/**
 * ¿Hay una persona del equipo metida en el caso de este contacto?
 *
 * Dos formas de estarlo, y las dos cuentan: que el hilo esté marcado como que
 * necesita una persona (o asignado a alguien), o que alguien del equipo haya
 * escrito en el último día. Ante cualquier error se responde que no, para no
 * frenar flujos por una consulta que falló.
 */
async function hayAlguienAtendiendo(contactId: string): Promise<string | null> {
  const db = supabaseAdmin()
  try {
    const desde = new Date(Date.now() - VENTANA_ATENDIDA_MS).toISOString()

    const { data: hilos } = await db
      .from('conversations')
      .select('id, needs_human_at, assigned_to')
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .gte('last_message_at', desde)
    const abiertos = (hilos ?? []) as Array<{
      id: string
      needs_human_at: string | null
      assigned_to: string | null
    }>
    if (abiertos.some((c) => c.needs_human_at || c.assigned_to)) {
      return 'caso en manos de una persona'
    }
    if (abiertos.length === 0) return null

    // Un mensaje escrito por alguien del equipo (no la IA: la IA ya la cubre
    // la ventana de cinco minutos, y frenar un día entero por un mensaje del
    // bot apagaría flujos legítimos).
    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', abiertos.map((c) => c.id))
      .eq('sender_type', 'agent')
      .is('origin', null)
      .gte('created_at', desde)
    return (count ?? 0) > 0 ? 'una persona contestó en las últimas 24 h' : null
  } catch (err) {
    console.error('[automations] guard: no se pudo mirar si alguien atiende:', err)
    return null
  }
}
