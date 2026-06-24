import type { AutomationTriggerType } from '@/types'

/**
 * Canonical registry of the data points an automation can read — ONE source of
 * truth shared by the condition builder AND the template-variable mapper, so
 * the UI never offers a field the backend doesn't set (and vice-versa).
 *
 * Each entry says: its plain-language label, which triggers expose it, whether
 * it's usable in conditions / template variables, and HOW the engine reads it
 * (a `context.vars.KEY`, a contact column, a tag, a segment, or the message).
 * Keep this in sync with what the webhooks seed (buildVarsForOrder in the
 * orders webhook, the cart-recovery cron, etc.).
 */

export type ValueKind = 'number' | 'text' | 'bool' | 'offer' | 'tag' | 'segment'

/** How a condition on this data point maps onto the engine's condition subjects. */
export type ConditionSource =
  | { kind: 'var'; varKey: string } // context.vars[varKey] via subject 'context_var'
  | { kind: 'contact_field'; column: string } // contacts column via subject 'contact_field'
  | { kind: 'tag' } // subject 'tag_presence'
  | { kind: 'segment' } // subject 'in_segment'
  | { kind: 'message' } // subject 'message_content'

export interface DataPoint {
  /** Stable id used in the picker + to rebuild a condition. */
  id: string
  /** i18n key (automations.dp*) — plain language. */
  labelKey: string
  group: 'order' | 'contact' | 'message'
  valueKind: ValueKind
  /** Triggers that expose this data point. 'all' = every trigger. */
  triggers: AutomationTriggerType[] | 'all'
  usableInConditions: boolean
  /** When templatable, the `{{vars.KEY}}` injected at send time. */
  templateVarKey?: string
  condition: ConditionSource
}

const ORDER_TRIGGERS: AutomationTriggerType[] = [
  'shopify_order_created',
  'shopify_order_fulfilled',
]
const FULFILLED: AutomationTriggerType[] = ['shopify_order_fulfilled']

export const DATA_POINTS: DataPoint[] = [
  // ── Order data (set by buildVarsForOrder + offer_* in the orders webhook) ──
  {
    id: 'offer_units',
    labelKey: 'automations.dpUnits',
    group: 'order',
    valueKind: 'number',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'offer_units',
    condition: { kind: 'var', varKey: 'offer_units' },
  },
  {
    id: 'offer_chosen',
    labelKey: 'automations.dpOffer',
    group: 'order',
    valueKind: 'offer',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'offer_chosen',
    condition: { kind: 'var', varKey: 'offer_chosen' },
  },
  {
    id: 'total_price',
    labelKey: 'automations.dpTotal',
    group: 'order',
    valueKind: 'number',
    triggers: ['shopify_order_created', 'shopify_order_fulfilled', 'shopify_abandoned_checkout'],
    usableInConditions: true,
    templateVarKey: 'total_price',
    condition: { kind: 'var', varKey: 'total_price' },
  },
  {
    id: 'item_count',
    labelKey: 'automations.dpItemCount',
    group: 'order',
    valueKind: 'number',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'item_count',
    condition: { kind: 'var', varKey: 'item_count' },
  },
  {
    id: 'first_item',
    labelKey: 'automations.dpFirstItem',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'first_item',
    condition: { kind: 'var', varKey: 'first_item' },
  },
  {
    id: 'is_repeat_customer',
    labelKey: 'automations.dpRepeatCustomer',
    group: 'order',
    valueKind: 'bool',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    condition: { kind: 'var', varKey: 'is_repeat_customer' },
  },
  {
    id: 'customer_name',
    labelKey: 'automations.dpCustomerName',
    group: 'order',
    valueKind: 'text',
    triggers: ['shopify_order_created', 'shopify_order_fulfilled', 'shopify_abandoned_checkout', 'post_delivery_feedback', 'customer_inactive'],
    usableInConditions: false,
    templateVarKey: 'customer_name',
    condition: { kind: 'var', varKey: 'customer_name' },
  },
  {
    id: 'order_name',
    labelKey: 'automations.dpOrderName',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'order_name',
    condition: { kind: 'var', varKey: 'order_name' },
  },
  {
    id: 'order_status_url',
    labelKey: 'automations.dpOrderStatusUrl',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'order_status_url',
    condition: { kind: 'var', varKey: 'order_status_url' },
  },
  {
    id: 'currency',
    labelKey: 'automations.dpCurrency',
    group: 'order',
    valueKind: 'text',
    triggers: ['shopify_order_created', 'shopify_order_fulfilled', 'shopify_abandoned_checkout'],
    usableInConditions: false,
    templateVarKey: 'currency',
    condition: { kind: 'var', varKey: 'currency' },
  },
  // Fulfilled-only
  {
    id: 'tracking_number',
    labelKey: 'automations.dpTrackingNumber',
    group: 'order',
    valueKind: 'text',
    triggers: FULFILLED,
    usableInConditions: true,
    templateVarKey: 'tracking_number',
    condition: { kind: 'var', varKey: 'tracking_number' },
  },
  {
    id: 'tracking_url',
    labelKey: 'automations.dpTrackingUrl',
    group: 'order',
    valueKind: 'text',
    triggers: FULFILLED,
    usableInConditions: false,
    templateVarKey: 'tracking_url',
    condition: { kind: 'var', varKey: 'tracking_url' },
  },
  {
    id: 'tracking_company',
    labelKey: 'automations.dpTrackingCompany',
    group: 'order',
    valueKind: 'text',
    triggers: FULFILLED,
    usableInConditions: false,
    templateVarKey: 'tracking_company',
    condition: { kind: 'var', varKey: 'tracking_company' },
  },
  // Abandoned checkout
  {
    id: 'checkout_url',
    labelKey: 'automations.dpCheckoutUrl',
    group: 'order',
    valueKind: 'text',
    triggers: ['shopify_abandoned_checkout'],
    usableInConditions: false,
    templateVarKey: 'checkout_url',
    condition: { kind: 'var', varKey: 'checkout_url' },
  },

  // ── Contact data (conditions only — interpolate() can't inject contact cols) ──
  {
    id: 'contact_name',
    labelKey: 'automations.dpContactName',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'contact_field', column: 'name' },
  },
  {
    id: 'contact_email',
    labelKey: 'automations.dpContactEmail',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'contact_field', column: 'email' },
  },
  {
    id: 'contact_company',
    labelKey: 'automations.dpContactCompany',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'contact_field', column: 'company' },
  },
  {
    id: 'last_offer_units',
    labelKey: 'automations.dpLastOfferUnits',
    group: 'contact',
    valueKind: 'number',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'contact_field', column: 'last_offer_units' },
  },
  {
    id: 'last_offer_chosen',
    labelKey: 'automations.dpLastOfferChosen',
    group: 'contact',
    valueKind: 'offer',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'contact_field', column: 'last_offer_chosen' },
  },
  {
    id: 'is_shopify_customer',
    labelKey: 'automations.dpIsCustomer',
    group: 'contact',
    valueKind: 'bool',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'contact_field', column: 'is_shopify_customer' },
  },
  {
    id: 'has_tag',
    labelKey: 'automations.dpHasTag',
    group: 'contact',
    valueKind: 'tag',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'tag' },
  },
  {
    id: 'in_segment',
    labelKey: 'automations.dpInSegment',
    group: 'contact',
    valueKind: 'segment',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'segment' },
  },

  // ── Message (keyword-style triggers) ──
  {
    id: 'message_text',
    labelKey: 'automations.dpMessageText',
    group: 'message',
    valueKind: 'text',
    triggers: ['new_message_received', 'first_inbound_message', 'keyword_match'],
    usableInConditions: true,
    condition: { kind: 'message' },
  },
]

function exposed(dp: DataPoint, trigger: AutomationTriggerType): boolean {
  return dp.triggers === 'all' || dp.triggers.includes(trigger)
}

/** Data points selectable in a CONDITION for this trigger. */
export function conditionDataPoints(trigger: AutomationTriggerType): DataPoint[] {
  return DATA_POINTS.filter((dp) => dp.usableInConditions && exposed(dp, trigger))
}

/** Data points injectable into a TEMPLATE variable for this trigger. */
export function templateDataPoints(trigger: AutomationTriggerType): DataPoint[] {
  return DATA_POINTS.filter((dp) => dp.templateVarKey && exposed(dp, trigger))
}

/** Lookup a data point by the `{{vars.KEY}}` stored in a template mapping. */
export function dataPointByTemplateVar(varKey: string): DataPoint | undefined {
  return DATA_POINTS.find((dp) => dp.templateVarKey === varKey)
}

export function dataPointById(id: string): DataPoint | undefined {
  return DATA_POINTS.find((dp) => dp.id === id)
}
