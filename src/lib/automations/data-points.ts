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

export type ValueKind =
  | 'number'
  | 'text'
  | 'bool'
  | 'offer'
  | 'product'
  | 'tag'
  | 'segment'
  /** Fixed set of values — the picker shows `options` instead of a free text
   *  box, so nobody has to know the internal spelling ("cancelled_by_customer"). */
  | 'enum'

/** How a condition on this data point maps onto the engine's condition subjects. */
export type ConditionSource =
  | { kind: 'var'; varKey: string } // context.vars[varKey] via subject 'context_var'
  | { kind: 'contact_field'; column: string } // contacts column via subject 'contact_field'
  | { kind: 'tag' } // subject 'tag_presence'
  | { kind: 'segment' } // subject 'in_segment'
  | { kind: 'message' } // subject 'message_content'
  | { kind: 'purchased' } // subject 'purchased' (se resuelve en vivo, con ventana)
  | { kind: 'messaged' } // subject 'messaged' (¿ya le escribimos?, con ventana)
  | { kind: 'rejected_open' } // subject 'rejected_open' (¿tiene un rechazo sin resolver?)
  | { kind: 'order_paid' } // subject 'order_paid' (¿el pedido ya está pagado?, en vivo)

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
  /** Allowed values for `valueKind: 'enum'`, in the order they're offered. */
  options?: { value: string; labelKey: string }[]
  condition: ConditionSource
}

const ORDER_TRIGGERS: AutomationTriggerType[] = [
  'shopify_order_created',
  'shopify_order_paid',
  'shopify_order_fulfilled',
  'shopify_order_delivered',
  'shopify_order_cancelled',
  'shopify_order_refunded',
]
// Datos de envío/tracking: existen al despachar y al entregar.
const FULFILLED: AutomationTriggerType[] = [
  'shopify_order_fulfilled',
  'shopify_order_delivered',
]

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
    triggers: [...ORDER_TRIGGERS, 'shopify_abandoned_checkout', 'payment_rejected'],
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
    // Disponible en todo disparador: si el webhook no trae el nombre (p. ej.
    // un keyword_match), el motor lo resuelve desde el contacto.
    triggers: 'all',
    usableInConditions: false,
    templateVarKey: 'customer_name',
    condition: { kind: 'var', varKey: 'customer_name' },
  },
  // ── Datos del cliente (los resuelve el motor desde el contacto al enviar) ──
  {
    id: 'customer_first_name',
    labelKey: 'automations.dpCustomerFirstName',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: false,
    templateVarKey: 'contact_first_name',
    condition: { kind: 'var', varKey: 'contact_first_name' },
  },
  {
    id: 'customer_last_name',
    labelKey: 'automations.dpCustomerLastName',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: false,
    templateVarKey: 'contact_last_name',
    condition: { kind: 'var', varKey: 'contact_last_name' },
  },
  {
    id: 'customer_email',
    labelKey: 'automations.dpCustomerEmail',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: false,
    templateVarKey: 'contact_email',
    condition: { kind: 'var', varKey: 'contact_email' },
  },
  {
    id: 'customer_phone',
    labelKey: 'automations.dpCustomerPhone',
    group: 'contact',
    valueKind: 'text',
    triggers: 'all',
    usableInConditions: false,
    templateVarKey: 'contact_phone',
    condition: { kind: 'var', varKey: 'contact_phone' },
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
    triggers: [...ORDER_TRIGGERS, 'shopify_abandoned_checkout', 'payment_rejected'],
    usableInConditions: false,
    templateVarKey: 'currency',
    condition: { kind: 'var', varKey: 'currency' },
  },
  {
    id: 'order_number',
    labelKey: 'automations.dpOrderNumber',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'order_number',
    condition: { kind: 'var', varKey: 'order_number' },
  },
  {
    id: 'subtotal_price',
    labelKey: 'automations.dpSubtotal',
    group: 'order',
    valueKind: 'number',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'subtotal_price',
    condition: { kind: 'var', varKey: 'subtotal_price' },
  },
  {
    id: 'total_discounts',
    labelKey: 'automations.dpDiscounts',
    group: 'order',
    valueKind: 'number',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'total_discounts',
    condition: { kind: 'var', varKey: 'total_discounts' },
  },
  {
    // Se puede preguntar: es lo que separa un pedido pagado de uno que espera
    // una transferencia, y sin esto no había forma de armar ese flujo.
    id: 'financial_status',
    labelKey: 'automations.dpFinancialStatus',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    templateVarKey: 'financial_status',
    condition: { kind: 'var', varKey: 'financial_status' },
  },
  {
    // La versión en vivo del anterior. El webhook trae el estado que el
    // pedido tenía al crearse y ese dato queda congelado en el contexto; la
    // pregunta después de una espera sólo significa algo si se vuelve a
    // consultar. Es la diferencia entre recordarle la transferencia a quien
    // no pagó y molestar a quien ya pagó.
    id: 'order_paid',
    labelKey: 'automations.dpOrderPaid',
    group: 'order',
    valueKind: 'bool',
    triggers: ORDER_TRIGGERS,
    usableInConditions: true,
    condition: { kind: 'order_paid' },
  },
  {
    id: 'fulfillment_status',
    labelKey: 'automations.dpFulfillmentStatus',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'fulfillment_status',
    condition: { kind: 'var', varKey: 'fulfillment_status' },
  },
  {
    id: 'shipping_address',
    labelKey: 'automations.dpShippingAddress',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'shipping_address',
    condition: { kind: 'var', varKey: 'shipping_address' },
  },
  {
    id: 'shipping_city',
    labelKey: 'automations.dpShippingCity',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'shipping_city',
    condition: { kind: 'var', varKey: 'shipping_city' },
  },
  {
    id: 'shipping_province',
    labelKey: 'automations.dpShippingProvince',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'shipping_province',
    condition: { kind: 'var', varKey: 'shipping_province' },
  },
  {
    id: 'shipping_zip',
    labelKey: 'automations.dpShippingZip',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'shipping_zip',
    condition: { kind: 'var', varKey: 'shipping_zip' },
  },
  {
    id: 'shipping_country',
    labelKey: 'automations.dpShippingCountry',
    group: 'order',
    valueKind: 'text',
    triggers: ORDER_TRIGGERS,
    usableInConditions: false,
    templateVarKey: 'shipping_country',
    condition: { kind: 'var', varKey: 'shipping_country' },
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

  // ── Pago rechazado (los siembra el cron mercadopago-recovery) ──
  {
    id: 'payment_reason',
    labelKey: 'automations.dpPaymentReason',
    group: 'order',
    valueKind: 'text',
    triggers: ['payment_rejected'],
    usableInConditions: true,
    templateVarKey: 'payment_reason',
    condition: { kind: 'var', varKey: 'payment_reason' },
  },
  {
    // La única que se resuelve en vivo al evaluarse, no con lo que había al
    // disparar. Sirve en cualquier flujo que espere algo del cliente antes
    // de insistir: pago rechazado, carrito, encuesta, recompra.
    id: 'purchased',
    labelKey: 'automations.dpPurchased',
    group: 'order',
    valueKind: 'bool',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'purchased' },
  },
  {
    // Para que un flujo pueda apartarse cuando otro ya le hablo a esa
    // persona. Sirve en cualquiera: carrito, pagos, reactivacion.
    id: 'messaged',
    labelKey: 'automations.dpMessaged',
    group: 'contact',
    valueKind: 'bool',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'messaged' },
  },
  {
    // El cruce entre los dos rescates, dicho en el lienzo. Un rechazo de
    // tarjeta deja el checkout abierto, así que la misma persona entra por
    // los dos lados: sin preguntarlo, recibe "dejaste algo a medias" y
    // "no pudimos procesar tu pago" con minutos de diferencia.
    id: 'rejected_open',
    labelKey: 'automations.dpRejectedOpen',
    group: 'order',
    valueKind: 'bool',
    triggers: 'all',
    usableInConditions: true,
    condition: { kind: 'rejected_open' },
  },
  {
    id: 'payment_attempts',
    labelKey: 'automations.dpPaymentAttempts',
    group: 'order',
    valueKind: 'number',
    triggers: ['payment_rejected'],
    usableInConditions: true,
    templateVarKey: 'payment_attempts',
    condition: { kind: 'var', varKey: 'payment_attempts' },
  },
  {
    id: 'installments',
    labelKey: 'automations.dpInstallments',
    group: 'order',
    valueKind: 'number',
    triggers: ['payment_rejected'],
    usableInConditions: true,
    templateVarKey: 'installments',
    condition: { kind: 'var', varKey: 'installments' },
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
    id: 'last_product',
    labelKey: 'automations.dpLastProduct',
    group: 'contact',
    // Dropdown de productos sincronizados con Shopify (mira shopify_products.title),
    // en vez de texto libre — el merchant elige de sus productos reales.
    valueKind: 'product',
    triggers: 'all',
    usableInConditions: true,
    templateVarKey: 'last_product',
    condition: { kind: 'contact_field', column: 'last_product' },
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

  // ── Voice call result ──
  // Seeded twice over: by `persistCallResult` for the voice_call_completed
  // trigger, and by a `voice_call` step that waits for its result — which is
  // why `exposed()` also lets them through on any automation that calls.
  {
    id: 'call_status',
    labelKey: 'automations.dpCallStatus',
    group: 'message',
    valueKind: 'enum',
    triggers: ['voice_call_completed'],
    usableInConditions: true,
    templateVarKey: 'call_status',
    // Only the states a FINISHED call can be in: queued/dialing/in_progress
    // never reach a condition, so offering them would just be a dead choice.
    options: [
      { value: 'completed', labelKey: 'voice.statusCompleted' },
      { value: 'no_answer', labelKey: 'voice.statusNoAnswer' },
      { value: 'busy', labelKey: 'voice.statusBusy' },
      { value: 'voicemail', labelKey: 'voice.statusVoicemail' },
      { value: 'failed', labelKey: 'voice.statusFailed' },
      { value: 'canceled', labelKey: 'voice.statusCanceled' },
    ],
    condition: { kind: 'var', varKey: 'call_status' },
  },
  {
    id: 'call_outcome',
    labelKey: 'automations.dpCallOutcome',
    group: 'message',
    valueKind: 'enum',
    triggers: ['voice_call_completed'],
    usableInConditions: true,
    templateVarKey: 'call_outcome',
    options: [
      { value: 'confirmed', labelKey: 'voice.outcomeConfirmed' },
      { value: 'cancelled_by_customer', labelKey: 'voice.outcomeCancelled' },
      { value: 'rescheduled', labelKey: 'voice.outcomeRescheduled' },
      { value: 'recovered', labelKey: 'voice.outcomeRecovered' },
      { value: 'declined', labelKey: 'voice.outcomeDeclined' },
      { value: 'callback_requested', labelKey: 'voice.outcomeCallback' },
      { value: 'opt_out', labelKey: 'voice.outcomeOptOut' },
      { value: 'no_outcome', labelKey: 'voice.outcomeNone' },
    ],
    condition: { kind: 'var', varKey: 'call_outcome' },
  },
  {
    id: 'call_duration',
    labelKey: 'automations.dpCallDuration',
    group: 'message',
    valueKind: 'number',
    triggers: ['voice_call_completed'],
    usableInConditions: true,
    templateVarKey: 'call_duration',
    condition: { kind: 'var', varKey: 'call_duration' },
  },
  {
    id: 'call_summary',
    labelKey: 'automations.dpCallSummary',
    group: 'message',
    valueKind: 'text',
    triggers: ['voice_call_completed'],
    usableInConditions: false,
    templateVarKey: 'call_summary',
    condition: { kind: 'var', varKey: 'call_summary' },
  },
]

/**
 * Data points seeded by a `voice_call` step that WAITS for its result, not by
 * the trigger. Any automation that calls has them from that step onward,
 * whatever started it — that's what lets "llamar; si no contesta, mandar
 * WhatsApp" live in one automation instead of two.
 */
const VOICE_RESULT_DP_IDS = ['call_status', 'call_outcome', 'call_duration', 'call_summary']

export interface DataPointScope {
  /** True when the automation being edited contains a call step. */
  hasVoiceCall?: boolean
}

function exposed(
  dp: DataPoint,
  trigger: AutomationTriggerType,
  scope?: DataPointScope,
): boolean {
  if (dp.triggers === 'all' || dp.triggers.includes(trigger)) return true
  return Boolean(scope?.hasVoiceCall) && VOICE_RESULT_DP_IDS.includes(dp.id)
}

/** Data points selectable in a CONDITION for this trigger. */
export function conditionDataPoints(
  trigger: AutomationTriggerType,
  scope?: DataPointScope,
): DataPoint[] {
  return DATA_POINTS.filter((dp) => dp.usableInConditions && exposed(dp, trigger, scope))
}

/** Data points injectable into a TEMPLATE variable for this trigger. */
export function templateDataPoints(
  trigger: AutomationTriggerType,
  scope?: DataPointScope,
): DataPoint[] {
  return DATA_POINTS.filter((dp) => dp.templateVarKey && exposed(dp, trigger, scope))
}

/**
 * Todos los campos dinámicos que un {{n}} de plantilla puede representar (unión
 * de todos los disparadores). Lo usa el editor de plantillas, que no está atado
 * a un disparador: la plantilla declara qué representa cada variable y la
 * automatización que la use lo mapea solo.
 */
export function allTemplateDataPoints(): DataPoint[] {
  return DATA_POINTS.filter((dp) => dp.templateVarKey)
}

/** Valor de ejemplo realista por campo (para el `example` que Meta exige). */
export const TEMPLATE_VAR_SAMPLES: Record<string, string> = {
  customer_name: 'María',
  contact_first_name: 'María',
  contact_last_name: 'González',
  contact_email: 'maria@correo.com',
  contact_phone: '+54 9 11 1234 5678',
  last_product: 'Serum Pilar',
  order_name: '#1042',
  order_number: '1042',
  total_price: '49.900',
  subtotal_price: '45.900',
  total_discounts: '4.000',
  currency: 'ARS',
  offer_units: '3',
  offer_chosen: '3+1 gratis',
  item_count: '1',
  first_item: 'Serum Pilar',
  financial_status: 'paid',
  fulfillment_status: 'fulfilled',
  shipping_address: 'Av. Corrientes 1234',
  shipping_city: 'Buenos Aires',
  shipping_province: 'CABA',
  shipping_zip: '1043',
  shipping_country: 'Argentina',
  tracking_number: 'AR123456789',
  tracking_url: 'https://andreani.com/seguimiento',
  tracking_company: 'Andreani',
  order_status_url: 'https://pilar.co/pedido/1042',
  checkout_url: 'https://pilar.co/carrito',
}

/** Ejemplo para un campo (cae a un genérico si no hay uno específico). */
export function sampleForTemplateVar(key: string): string {
  return TEMPLATE_VAR_SAMPLES[key] ?? 'ejemplo'
}

/** Lookup a data point by the `{{vars.KEY}}` stored in a template mapping. */
export function dataPointByTemplateVar(varKey: string): DataPoint | undefined {
  return DATA_POINTS.find((dp) => dp.templateVarKey === varKey)
}

export function dataPointById(id: string): DataPoint | undefined {
  return DATA_POINTS.find((dp) => dp.id === id)
}
