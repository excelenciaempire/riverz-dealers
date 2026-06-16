import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'cart_recovery'
  | 'new_order'
  | 'order_fulfilled'
  | 'follow_up_reminder'
  | 'repurchase_nudge'
  | 'welcome_new_contact'
  | 'feedback_post_delivery'
  | 'reengagement_14d'
  | 'keyword_catalog'
  | 'birthday_greeting'

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
  | 'shopping-bag'
  | 'gift'
  | 'package'
  | 'truck'
  | 'message-circle'
  | 'heart'
  | 'clock'
  | 'star'
  | 'sparkles'
  | 'repeat'
  | 'phone-call'
  | 'shopping-cart'

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
 * Pre-built automation templates the user can clone from /automatizaciones.
 * Every template is tuned around the data the trigger dispatchers expose
 * in `context.vars` — see src/app/api/shopify/webhooks/orders/route.ts
 * for Shopify keys and src/app/api/whatsapp/webhook/route.ts for inbound
 * message vars.
 *
 * Strategy:
 *  - First touches outside the 24-hour WhatsApp window use send_template.
 *  - In-window flows (welcomes, keyword replies) use send_message so the
 *    user doesn't need an approved template just to install the recipe.
 *  - All template_name / tag_id fields are left empty on purpose so the
 *    builder forces the user to pick concrete values before activation.
 */
export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  cart_recovery: {
    slug: 'cart_recovery',
    name: 'Recuperar carrito abandonado',
    description:
      'Cuando alguien deja el checkout, espera 2 h y envíale el enlace de pago por WhatsApp.',
    category: 'shopify',
    icon: 'shopping-cart',
    tags: ['Shopify', 'WhatsApp'],
    trigger_type: 'shopify_abandoned_checkout',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 2, unit: 'hours' },
      },
      {
        // First touch outside the 24h window needs an approved Meta template.
        // Pick one whose body uses {{customer_name}} / {{total_price}} /
        // {{checkout_url}} variables exposed by the webhook.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  new_order: {
    slug: 'new_order',
    name: 'Confirmar pedido',
    description:
      'Apenas Shopify registra el pedido, manda el resumen y agradece la compra por WhatsApp.',
    category: 'shopify',
    icon: 'package',
    tags: ['Shopify', 'WhatsApp'],
    trigger_type: 'shopify_order_created',
    trigger_config: {},
    steps: [
      {
        // Order confirmation template — variables: customer_name, order_name,
        // total_price, currency, item_count, first_item.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  order_fulfilled: {
    slug: 'order_fulfilled',
    name: 'Avisar despacho',
    description:
      'Cuando Shopify marca el pedido como despachado, envía el número y el enlace de seguimiento.',
    category: 'shopify',
    icon: 'truck',
    tags: ['Shopify', 'WhatsApp'],
    trigger_type: 'shopify_order_fulfilled',
    trigger_config: {},
    steps: [
      {
        // Tracking template — variables: customer_name, order_name,
        // tracking_company, tracking_number, tracking_url.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  welcome_new_contact: {
    slug: 'welcome_new_contact',
    name: 'Bienvenida nuevo cliente',
    description:
      'Cuando alguien escribe por primera vez, preséntate y abrí la conversación con una pregunta.',
    category: 'ventas',
    icon: 'sparkles',
    tags: ['WhatsApp', 'Ventas'],
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            '¡Hola! Gracias por escribirnos. Soy del equipo y te respondo en minutos. ¿Qué estás buscando hoy?',
        },
      },
    ],
  },

  reengagement_14d: {
    slug: 'reengagement_14d',
    name: 'Reactivar cliente inactivo',
    description:
      'Para clientes con al menos 1 pedido que llevan 14 días sin actividad, un mensaje suave para reabrir.',
    category: 'retencion',
    icon: 'heart',
    tags: ['Retención', 'WhatsApp'],
    trigger_type: 'time_based',
    trigger_config: { schedule: '0 14 * * *' },
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
    ],
  },

  feedback_post_delivery: {
    slug: 'feedback_post_delivery',
    name: 'Pedir feedback post-entrega',
    description:
      '3 días después de marcar el pedido como entregado, preguntá cómo le fue al cliente.',
    category: 'soporte',
    icon: 'star',
    tags: ['Shopify', 'WhatsApp', 'Soporte'],
    trigger_type: 'time_based',
    trigger_config: { schedule: '30 * * * *' },
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
    ],
  },

  keyword_catalog: {
    slug: 'keyword_catalog',
    name: 'Bienvenida por palabra clave',
    description:
      'Si el cliente escribe "catálogo", "productos" o "comprar", respondé al instante con las opciones.',
    category: 'ventas',
    icon: 'message-circle',
    tags: ['WhatsApp', 'Ventas'],
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['catalogo', 'catálogo', 'productos', 'comprar'],
      match_type: 'contains',
      case_sensitive: false,
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Te paso el catálogo en un segundo. Mientras tanto, ¿buscás algo en particular o querés ver lo más vendido?',
        },
      },
    ],
  },

  birthday_greeting: {
    slug: 'birthday_greeting',
    name: 'Cumpleaños del cliente',
    description:
      'El día del cumpleaños del contacto, saludalo con un mensaje personalizado y un descuento opcional.',
    category: 'recordatorios',
    icon: 'gift',
    tags: ['Retención', 'WhatsApp'],
    trigger_type: 'time_based',
    trigger_config: { schedule: '0 13 * * *' },
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
    ],
  },

  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Recordatorio de seguimiento',
    description:
      'Si un contacto escribió y nadie le respondió en 24 h, mandale un recordatorio amable.',
    category: 'soporte',
    icon: 'clock',
    tags: ['WhatsApp', 'Soporte'],
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        // After 24h the WhatsApp customer-service window closes, so we
        // must reopen the conversation with an approved template.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
    ],
  },

  repurchase_nudge: {
    slug: 'repurchase_nudge',
    name: 'Recompras',
    description:
      'Cuando un cliente vuelve a comprar, agradecé el regreso y proponé el próximo paso.',
    category: 'retencion',
    icon: 'repeat',
    tags: ['Shopify', 'WhatsApp', 'Retención'],
    trigger_type: 'shopify_order_created',
    trigger_config: {},
    steps: [
      {
        // Only fires when the Shopify customer.orders_count was > 1 at the
        // time of the webhook — see context.vars.is_repeat_customer in
        // src/app/api/shopify/webhooks/orders/route.ts.
        step_type: 'condition',
        step_config: {
          subject: 'context_var',
          operand: 'is_repeat_customer',
          value: 'true',
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'hours' },
        parent_index: 0,
        branch: 'yes',
      },
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
        parent_index: 0,
        branch: 'yes',
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
}

/**
 * Order used by the gallery on /automatizaciones. Anything not listed
 * here is appended in object-iteration order.
 */
export const TEMPLATE_GALLERY_ORDER: TemplateSlug[] = [
  'cart_recovery',
  'new_order',
  'order_fulfilled',
  'welcome_new_contact',
  'reengagement_14d',
  'feedback_post_delivery',
  'keyword_catalog',
  'birthday_greeting',
  'follow_up_reminder',
  'repurchase_nudge',
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
