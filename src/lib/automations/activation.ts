import { translate } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/config'
/**
 * La puerta de la activación, para todo el que la abra.
 *
 * Activar es el momento en que una automatización pasa de un borrador a algo
 * que le escribe a clientes reales, y por eso es donde se valida: un borrador
 * puede estar incompleto, uno activo no. La pantalla ya lo hacía; el MCP no, y
 * por ahí se podía prender una automatización inválida que después fallaba en
 * cada corrida con un error críptico en los registros.
 *
 * Este módulo es esa validación en un solo lugar, para que la pantalla, el MCP
 * y el Operator no puedan tener criterios distintos sobre qué se puede prender.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AutomationActivationState, AutomationTriggerType } from '@/types'
import { loadStepsTree } from './steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
  type ValidationIssue,
} from './validate'

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export interface AutomationReadiness {
  state: AutomationActivationState
  issues: ValidationIssue[]
}

/** Regla pura para pruebas y para no volver a separar toggle técnico y estado. */
export function operationalStateFor(
  requested: AutomationActivationState,
  issues: ValidationIssue[],
): AutomationActivationState {
  if (requested === 'draft') return 'draft'
  return issues.length === 0 ? 'active' : 'armed'
}

function issueWhatsappPayment(): ValidationIssue {
  return {
    path: 'whatsapp.health',
    message: 'Meta requires a payment method before business-initiated WhatsApp messages can send',
    key: 'automations.issueWhatsAppPagoPendiente',
  }
}

function issueWhatsappUnavailable(): ValidationIssue {
  return {
    path: 'whatsapp.health',
    message: 'WhatsApp is not ready to send business-initiated messages',
    key: 'automations.issueWhatsAppNoDisponible',
  }
}

/** Todo lo que impide activar esta configuración. Vacío = se puede prender. */
/**
 * Un problema de validación, dicho en el idioma de quien lo lee.
 *
 * Los mensajes se escribieron en inglés y en jerga —«active automations need at
 * least one step»— y salen por dos puertas que las dos las lee un comercio: el
 * aviso del editor y la vista previa del Operador. Traducir en el borde y no en
 * el validador lo deja puro, que es lo que permite probarlo sin locale.
 */
export function comoSeLee(issue: ValidationIssue, locale: string): string {
  return issue.key ? translate(locale as Locale, issue.key) : issue.message
}

/** Varios, ya en castellano y separados con punto y coma. */
export function comoSeLeen(issues: ValidationIssue[], locale: string): string {
  return issues.map((i) => comoSeLee(i, locale)).join('; ')
}

export function activationIssues(input: {
  triggerType: AutomationTriggerType | string
  triggerConfig: unknown
  steps: StepLike[]
}): ValidationIssue[] {
  return [
    ...validateTriggerForActivation(input.triggerType, input.triggerConfig),
    ...validateStepsForActivation(input.steps),
  ]
}

/**
 * Carga la automatización de la cuenta y devuelve por qué no se puede activar.
 *
 * Para quien tiene un id y nada más —el MCP, el Operator— y no la configuración
 * mergeada que ya tiene en la mano quien está guardando desde el editor.
 */
export async function activationIssuesById(
  db: SupabaseClient,
  automationId: string,
  workspaceId: string,
): Promise<ValidationIssue[]> {
  const { data } = await db
    .from('automations')
    .select('id, trigger_type, trigger_config')
    .eq('id', automationId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  const fila = data as
    | { id: string; trigger_type: string; trigger_config: unknown }
    | null
  if (!fila) throw new Error('esa automatización no existe en esta cuenta')

  const steps = (await loadStepsTree(fila.id)) as unknown as StepLike[]
  const issues = activationIssues({
    triggerType: fila.trigger_type,
    triggerConfig: fila.trigger_config,
    steps,
  })
  if ((fila.trigger_config as Record<string, unknown> | null)?.requires_integration === 'mercadopago') {
    // La integración todavía no expone un estado reutilizable desde el motor.
    // Mientras este bloqueo esté en el borrador, el flujo no puede activarse
    // por accidente; la conexión la reemplaza por su configuración real.
    issues.push({
      path: 'trigger.integration',
      message: 'Mercado Pago must be connected before activation',
      key: 'automations.issueMercadoPagoPendiente',
    })
  }
  // Una automatización que usa un borrador se puede armar, pero no prender.
  // Antes pasaba la validación y fallaba en cada envío hasta que alguien
  // revisaba el log. La aprobación de Meta es una dependencia real de la
  // activación, no una sugerencia de la tarjeta.
  const nombres = new Set<string>()
  const walk = (items: StepLike[]) => items.forEach((step) => {
    if (step.step_type === 'send_template') {
      const name = String(step.step_config?.template_name ?? '').trim()
      if (name) nombres.add(name)
      const variants = (step.step_config?.ab_test as { variants?: Array<{ template_name?: string }> } | undefined)?.variants ?? []
      for (const variant of variants) {
        const variantName = String(variant.template_name ?? '').trim()
        if (variantName) nombres.add(variantName)
      }
    }
    if (step.branches) {
      walk(step.branches.yes ?? [])
      walk(step.branches.no ?? [])
    }
  })
  walk(steps)
  if (nombres.size > 0) {
    const { data: templates } = await db
      .from('message_templates')
      .select('name, status')
      .eq('workspace_id', workspaceId)
      .in('name', [...nombres])
    const approved = new Set(
      (templates ?? [])
        .filter((t) => String(t.status ?? '').toLowerCase() === 'approved')
        .map((t) => String(t.name)),
    )
    if ([...nombres].some((name) => !approved.has(name))) {
      issues.push({
        path: 'steps',
        message: 'all templates must be approved by Meta before activation',
        key: 'automations.issuePlantillaNoAprobada',
      })
    }

    // Los flujos proactivos de Rasmiaw se envían por WhatsApp. La salud de
    // Meta es una dependencia del flujo, no sólo un detalle del canal: el
    // código 141006 bloquea precisamente estos mensajes hasta agregar tarjeta.
    const { data: connection } = await db
      .from('channel_connections')
      .select('status, health_can_send, health_blockers')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'whatsapp')
      .eq('status', 'connected')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const health = connection as {
      health_can_send?: string | null
      health_blockers?: Array<{ code?: number | null }> | null
    } | null
    if (!health) {
      issues.push(issueWhatsappUnavailable())
    } else {
      const blockers = health.health_blockers ?? []
      if (blockers.some((blocker) => blocker.code === 141006)) {
        issues.push(issueWhatsappPayment())
      } else if (String(health.health_can_send ?? '').toUpperCase() === 'BLOCKED') {
        issues.push(issueWhatsappUnavailable())
      }
    }
  }
  return issues
}

function serializedIssues(issues: ValidationIssue[]) {
  return issues.map(({ path, key, message }) => ({ path, key, message }))
}

/**
 * Recalcula un flujo solicitado y deja `is_active` en sincronía con su estado
 * operativo. Es la única puerta que puede encender el motor.
 */
export async function reconcileAutomationReadiness(
  db: SupabaseClient,
  automationId: string,
  workspaceId: string,
): Promise<AutomationReadiness> {
  const { data: current, error: currentError } = await db
    .from('automations')
    .select('id, activation_state')
    .eq('id', automationId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (currentError) throw new Error(currentError.message)
  if (!current) throw new Error('esa automatización no existe en esta cuenta')

  const currentState = String((current as { activation_state?: string | null }).activation_state ?? 'draft') as AutomationActivationState
  if (currentState === 'draft') {
    await db.from('automations').update({ is_active: false, activation_blockers: [] }).eq('id', automationId)
    return { state: 'draft', issues: [] }
  }

  const issues = await activationIssuesById(db, automationId, workspaceId)
  const state = operationalStateFor(currentState, issues)
  const { error } = await db
    .from('automations')
    .update({
      activation_state: state,
      is_active: state === 'active',
      activation_blockers: serializedIssues(issues),
    })
    .eq('id', automationId)
    .eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)
  return { state, issues }
}

/** Arma un flujo sin enviar nada; si ya está listo, queda activo de inmediato. */
export async function armAutomation(
  db: SupabaseClient,
  automationId: string,
  workspaceId: string,
): Promise<AutomationReadiness> {
  const { error } = await db
    .from('automations')
    .update({
      activation_state: 'armed',
      is_active: false,
      activation_requested_at: new Date().toISOString(),
    })
    .eq('id', automationId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  return reconcileAutomationReadiness(db, automationId, workspaceId)
}

/** Revisa todos los flujos solicitados de una cuenta después de un cambio Meta. */
export async function reconcileWorkspaceAutomationReadiness(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Array<{ id: string; state: AutomationActivationState; issues: ValidationIssue[] }>> {
  const { data, error } = await db
    .from('automations')
    .select('id, activation_state')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .in('activation_state', ['armed', 'active'])
  if (error) throw new Error(error.message)
  return Promise.all((data ?? []).map(async (automation) => ({
    id: String(automation.id),
    ...(await reconcileAutomationReadiness(db, String(automation.id), workspaceId)),
  })))
}

/** Como la anterior, pero corta con un mensaje legible en vez de devolver la lista. */
export async function assertActivable(
  db: SupabaseClient,
  automationId: string,
  workspaceId: string,
): Promise<void> {
  const issues = await activationIssuesById(db, automationId, workspaceId)
  if (issues.length === 0) return
  // El detalle importa: casi siempre falta el nombre de la plantilla o la
  // etiqueta, y sin decir cuál la respuesta no sirve para arreglarlo.
  throw new Error(
    `no se puede activar todavía — ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
  )
}
