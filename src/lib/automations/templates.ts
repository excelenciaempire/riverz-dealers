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
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

/**
 * Pre-built automation templates the user can clone from /automations.
 * Every template is tuned around the Shopify data the orders / checkouts
 * webhooks expose in `context.vars` — see
 * src/app/api/shopify/webhooks/orders/route.ts for the keys.
 *
 * Strategy:
 *  - Cart recovery, order confirmation and fulfillment notifications use
 *    Meta WhatsApp templates (send_template) because the first touch can
 *    happen outside the 24-hour customer-service window.
 *  - The repurchase nudge piggybacks on `shopify_order_created` and
 *    branches on the `is_repeat_customer` context flag instead of needing
 *    a dedicated trigger or background cron.
 *  - Follow-up reminder stays channel-agnostic — it reacts to any
 *    inbound message that the team doesn't answer, regardless of channel.
 */
export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  cart_recovery: {
    slug: 'cart_recovery',
    name: 'Carrito abandonado',
    description:
      'Si alguien deja el checkout, esperá 15 min y mandale el link de pago por WhatsApp.',
    trigger_type: 'shopify_abandoned_checkout',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 15, unit: 'minutes' },
      },
      {
        // First touch outside the 24h window needs an approved Meta template.
        // Pick one whose body uses the {{customer_name}} / {{total_price}} /
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
    name: 'Nuevo pedido',
    description:
      'Confirmá la compra por WhatsApp apenas Shopify registra el pedido.',
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
    name: 'Pedido despachado',
    description:
      'Cuando Shopify marca el pedido como despachado, enviá el número y link de tracking.',
    trigger_type: 'shopify_order_fulfilled',
    trigger_config: {},
    steps: [
      {
        // Tracking template — variables: customer_name, order_name,
        // tracking_company, tracking_number, tracking_url.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
    ],
  },

  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Recordatorio de seguimiento',
    description:
      'Si un contacto escribió y nadie le respondió en 24 h, mandale un recordatorio.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Hola, ¿pudiste ver mi mensaje? Quedo atento.',
        },
      },
    ],
  },

  repurchase_nudge: {
    slug: 'repurchase_nudge',
    name: 'Recompras',
    description:
      'Cuando un cliente vuelve a comprar, agradecele y proponé el próximo paso.',
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

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
