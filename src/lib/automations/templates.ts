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
}

/**
 * Galería curada de plantillas de automatizaciones. La sentamos en sólo
 * cinco recetas por pedido del equipo: cada una resuelve un problema
 * concreto del ciclo Shopify + WhatsApp y deja al usuario completar el
 * `template_name` / `tag_id` antes de activar, para que validate.ts no
 * permita disparar campañas a medio configurar.
 *
 * Las variables usadas en `send_message` (p.ej. `{{customer_name}}`,
 * `{{checkout_url}}`, `{{order_name}}`, `{{tracking_url}}`) son las que
 * exponen los dispatchers en `context.vars` — ver
 * `src/app/api/shopify/webhooks/orders/route.ts` y los crons de Shopify
 * para la lista completa.
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
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 2, unit: 'hours' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Hola {{customer_name}}, te dejaste el carrito sin terminar. Te lo guardamos por si querés retomarlo: {{checkout_url}}. Recordá que con nosotros el envío es gratis.',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: 'carrito-recuperacion' },
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
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Gracias por tu compra, {{customer_name}}. Confirmamos el pedido {{order_name}} por {{total_price}} {{currency}}. Te avisamos apenas salga.',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: 'pedido-confirmado' },
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
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Tu pedido salió. Número de seguimiento: {{tracking_number}}. Lo seguís acá: {{tracking_url}}. ETA estimado 3 a 5 días hábiles.',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: 'pedido-despachado' },
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
    trigger_type: 'time_based',
    trigger_config: { event: 'post_delivered', days_after: 3 },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            '{{customer_name}}, ¿cómo te fue con tu pedido? Cualquier feedback nos sirve un montón.',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: 'feedback-pedido' },
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
    trigger_type: 'time_based',
    trigger_config: { event: 'last_order_days_ago', days_threshold: 45 },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Hola {{customer_name}}, hace un tiempo del último pedido. ¿Te queda poco del Sérum? Si querés reponer te dejo el link para volver a llevar.',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: 'recompra-recordatorio' },
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
