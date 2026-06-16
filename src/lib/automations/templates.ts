import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'carrito-abandonado'
  | 'nuevo-pedido'
  | 'enviar-tracking'
  | 'post-survey'
  | 'recompras'

export type TemplateCategory =
  | 'shopify'
  | 'ventas'
  | 'soporte'
  | 'retencion'
  | 'recordatorios'

/**
 * Lucide icon name (string). The page maps these to the actual
 * imported icon components — keeping the catalog import-free means
 * server-side code can read this file without dragging react into the
 * bundle.
 */
export type TemplateIconName =
  | 'shopping-cart'
  | 'package-check'
  | 'truck'
  | 'star'
  | 'repeat-2'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  /** Bucket the card belongs to. Used to colour-code or group. */
  category: TemplateCategory
  icon: TemplateIconName
  /** Short pills shown at the bottom of the gallery card. */
  tags: string[]
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
  /**
   * Suggested copy for the Meta-approved template the user must
   * register before activation. Kept here so the editor can show it as
   * pre-filled guidance. NOT stored anywhere — purely descriptive.
   */
  suggested_template_body?: string
}

/**
 * Galería curada de plantillas de automatizaciones. La sentamos en
 * sólo cinco recetas por pedido del equipo: cada una resuelve un
 * problema concreto del ciclo Shopify + WhatsApp.
 *
 * Reglas de seeding:
 *
 *  - `send_template` con `template_name: ''` para forzar al usuario a
 *    elegir una plantilla Meta aprobada (validate.ts no deja activar
 *    con string vacío). El motor solo soporta `send_template` fuera
 *    de la ventana de 24h, y todas estas plantillas pueden disparar
 *    fuera de la ventana (después de wait o tiempo absoluto).
 *  - `tag_id: ''` para evitar que un slug como 'pedido-confirmado' caiga
 *    en la insert de contact_tags (FK a tags.id por UUID). El usuario
 *    debe elegir una etiqueta real antes de activar.
 *
 * El editor surfacea el `suggested_template_body` como pista para que
 * el merchant registre el template en Meta con el cuerpo correcto.
 */
export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  'carrito-abandonado': {
    slug: 'carrito-abandonado',
    name: 'Carrito abandonado',
    description:
      'Recuperá ventas perdidas. Cuando un cliente abandona su carrito en Shopify, le mandamos un mensaje 2 horas después con el link para retomar y un recordatorio del envío gratis.',
    category: 'shopify',
    icon: 'shopping-cart',
    tags: ['Shopify', 'Recovery'],
    trigger_type: 'shopify_abandoned_checkout',
    trigger_config: {},
    suggested_template_body:
      'Hola {{customer_name}}, te dejaste el carrito sin terminar. Te lo guardamos por si querés retomarlo: {{checkout_url}}. Recordá que con nosotros el envío es gratis.',
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 2, unit: 'hours' },
      },
      {
        // After a 2h wait we're outside Meta's 24h customer-service
        // window — only approved templates can be sent. Free-text
        // `send_message` would fail at runtime.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // tag_id is left blank so validate.ts blocks activation until
        // the user picks a real tag. The slug 'carrito-recuperacion' is
        // a hint for what to call it.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'nuevo-pedido': {
    slug: 'nuevo-pedido',
    name: 'Nuevo pedido',
    description:
      'Confirmamos al cliente apenas hace un pedido en Shopify. Le mandamos un resumen con el número de orden, el total y un agradecimiento.',
    category: 'shopify',
    icon: 'package-check',
    tags: ['Shopify', 'Confirmación'],
    trigger_type: 'shopify_order_created',
    trigger_config: {},
    suggested_template_body:
      'Gracias por tu compra, {{customer_name}}. Confirmamos el pedido {{order_name}} por {{total_price}} {{currency}}. Te avisamos apenas salga.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // slug 'pedido-confirmado' as guidance.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'enviar-tracking': {
    slug: 'enviar-tracking',
    name: 'Enviar tracking',
    description:
      'Cuando despachamos un pedido, le mandamos al cliente el número de seguimiento y el link del courier.',
    category: 'shopify',
    icon: 'truck',
    tags: ['Shopify', 'Envíos'],
    trigger_type: 'shopify_order_fulfilled',
    trigger_config: {},
    suggested_template_body:
      'Tu pedido salió. Número de seguimiento: {{tracking_number}}. Lo seguís acá: {{tracking_url}}. ETA estimado 3 a 5 días hábiles.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // slug 'pedido-despachado' as guidance.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'post-survey': {
    slug: 'post-survey',
    name: 'Post survey',
    description:
      'Tres días después de que llega el pedido, le preguntamos al cliente cómo le fue. La respuesta queda registrada en la conversación para revisar.',
    category: 'retencion',
    icon: 'star',
    tags: ['Encuestas', 'Retención'],
    // Dedicated cron in /api/cron/shopify-feedback discovers
    // automations by this trigger_type + reads `days_after` from
    // trigger_config to know when to fire.
    trigger_type: 'post_delivery_feedback',
    trigger_config: { days_after: 3 },
    suggested_template_body:
      '{{customer_name}}, ¿cómo te fue con tu pedido? Cualquier feedback nos sirve un montón.',
    steps: [
      {
        // The cron dispatch always fires outside the 24h window —
        // send_template is the only safe choice.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // slug 'feedback-pedido' as guidance.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  recompras: {
    slug: 'recompras',
    name: 'Recompras',
    description:
      'Cuando un cliente lleva 45 días desde su último pedido, le mandamos un recordatorio suave por si quiere reponer stock. Solo dispara una vez por ciclo de recompra.',
    category: 'retencion',
    icon: 'repeat-2',
    tags: ['Retención', 'Recompras'],
    // Dedicated cron in /api/cron/reengagement reads
    // `days_threshold` from trigger_config to know the inactivity
    // cutoff.
    trigger_type: 'customer_inactive',
    trigger_config: { days_threshold: 45 },
    suggested_template_body:
      'Hola {{customer_name}}, hace un tiempo del último pedido. ¿Te queda poco del Sérum? Si querés reponer te dejo el link para volver a llevar.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // slug 'recompra-recordatorio' as guidance.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
}

/**
 * Order used by the gallery on /automatizaciones. Anything not listed
 * here is appended in object-iteration order.
 */
export const TEMPLATE_GALLERY_ORDER: TemplateSlug[] = [
  'carrito-abandonado',
  'nuevo-pedido',
  'enviar-tracking',
  'post-survey',
  'recompras',
]

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}

export function listTemplates(): AutomationTemplateDefinition[] {
  const seen = new Set<TemplateSlug>()
  const out: AutomationTemplateDefinition[] = []
  for (const slug of TEMPLATE_GALLERY_ORDER) {
    const t = AUTOMATION_TEMPLATES[slug]
    if (t) {
      out.push(t)
      seen.add(slug)
    }
  }
  for (const slug of Object.keys(AUTOMATION_TEMPLATES) as TemplateSlug[]) {
    if (!seen.has(slug)) out.push(AUTOMATION_TEMPLATES[slug])
  }
  return out
}
