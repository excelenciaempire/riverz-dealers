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
import type { AutomationTriggerType } from '@/types'
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
  }
  return issues
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
