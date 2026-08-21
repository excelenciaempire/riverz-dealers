import { CONDITION_SUBJECTS, type AutomationTriggerType } from '@/types'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

/**
 * Sujetos de condición que no llevan `operand`: la pregunta ya está completa
 * sin él. "¿Pagó el pedido?" es sobre el pedido de este flujo, no sobre una
 * ventana de tiempo ni una columna.
 */
const SUBJECTS_WITHOUT_OPERAND = new Set(['order_paid', 'message_content'])

/** Las preguntas que el motor sabe contestar, para poder comparar acá. */
const SUBJECTS = new Set<string>(CONDITION_SUBJECTS)

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'active automations need at least one step',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      break
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'template name is required' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'tag is required' })
      } else if (!isUuid(c.tag_id)) {
        // Templates seed slug placeholders (e.g. "carrito-recuperacion")
        // so the user has to swap them for a real tag before activating.
        // Without this guard, the engine accepts the slug and the
        // contact_tags FK to tags.id rejects it at runtime.
        issues.push({
          path: `${path}.tag_id`,
          message: 'tag id must be an existing tag',
        })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'agent is required when mode is "specific"',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    case 'wait':
      if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
        issues.push({ path: `${path}.amount`, message: 'wait amount must be greater than 0' })
      }
      if (!['minutes', 'hours', 'days'].includes(String(c.unit))) {
        issues.push({
          path: `${path}.unit`,
          message: 'wait unit must be minutes, hours, or days',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, message: 'condition subject is required' })
      } else if (!SUBJECTS.has(String(c.subject))) {
        // Un sujeto que no está en la lista cae al `default: return false` del
        // motor: la pregunta contesta que no para siempre. Marcarlo no puede
        // romper nada que hoy funcione — nombra algo que ya estaba roto en
        // silencio. Pasó con `subject: "tag"`, y la automatización entera no le
        // escribió nunca a nadie.
        issues.push({
          path: `${path}.subject`,
          message: `unknown condition subject: ${String(c.subject)}`,
        })
      } else if (
        (String(c.subject) === 'tag_presence' || String(c.subject) === 'in_segment') &&
        nonEmpty(c.operand) &&
        !isUuid(c.operand)
      ) {
        // El motor compara contra un id. Con un nombre ahí, el filtro no
        // matchea nunca: mismo argumento que el de `add_tag.tag_id`.
        issues.push({
          path: `${path}.operand`,
          message: 'condition operand must be an existing tag or segment',
        })
      }
      // `operand` es el complemento del sujeto: la columna, la etiqueta, la
      // ventana. Hay sujetos que no lo necesitan porque la pregunta ya está
      // completa sin él — "¿pagó el pedido?" es sobre el pedido de este
      // flujo, no sobre un plazo. Exigirlo dejaba el flujo sin poder
      // guardarse con un error que no se podía resolver desde la pantalla.
      if (!SUBJECTS_WITHOUT_OPERAND.has(String(c.subject)) && !nonEmpty(c.operand)) {
        issues.push({ path: `${path}.operand`, message: 'condition operand is required' })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'webhook URL is required' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'webhook URL must use http or https',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'webhook URL is not a valid URL' })
      }
      break
    case 'voice_call':
      // Faltaba este caso, y el `default` de abajo lo trataba como un tipo
      // desconocido: activar CUALQUIER automatización que tuviera un paso
      // "Llamar con IA" devolvía 400 con "unknown step type: voice_call". El
      // paso se podía agregar en el lienzo y guardar como borrador, pero
      // nunca llegar a correr — por eso no existe ni una sola automatización
      // con llamada en producción.
      //
      // Lo único obligatorio es el agente: sin él, `enqueueVoiceCallStep`
      // tira. El objetivo es opcional (el agente ya tiene el suyo) y el tipo
      // de llamada lo deduce el disparador.
      if (!nonEmpty(c.agent_id)) {
        issues.push({ path: `${path}.agent_id`, message: 'voice agent is required' })
      }
      break
    case 'close_conversation':
      // No config required.
      break
    default:
      issues.push({ path, message: `unknown step type: ${step.step_type}` })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'at least one keyword is required' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'keywords cannot be empty strings' })
    }
    if (cfg.match_type !== 'exact' && cfg.match_type !== 'contains') {
      issues.push({
        path: 'trigger.match_type',
        message: 'match type must be "exact" or "contains"',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'schedule is required' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'tag is required' })
    }
  } else if (triggerType === 'post_delivery_feedback') {
    const n = cfg.days_after
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      issues.push({
        path: 'trigger.days_after',
        message: 'days after delivery must be greater than 0',
      })
    }
  } else if (triggerType === 'customer_inactive') {
    const n = cfg.days_threshold
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      issues.push({
        path: 'trigger.days_threshold',
        message: 'days since last order must be greater than 0',
      })
    }
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v)
}
