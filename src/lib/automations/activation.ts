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

  return activationIssues({
    triggerType: fila.trigger_type,
    triggerConfig: fila.trigger_config,
    steps: (await loadStepsTree(fila.id)) as unknown as StepLike[],
  })
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
