import type { TFn } from '@/lib/i18n/translate'
import type { AutomationTriggerType } from '@/types'

/**
 * Cómo se nombra un activador en pantalla.
 *
 * Vive fuera del constructor porque el chat que opera la cuenta dibuja la
 * MISMA automatización: mientras cada lado tuvo su propia lista, el lienzo del
 * chat decía «entró un pedido nuevo» y el del editor «Nuevo pedido» para la
 * misma automatización, y no había forma de saber si eran dos cosas distintas.
 */

// La lista que se OFRECE al armar una automatización. `label` es una clave de
// i18n, resuelta con t() donde se pinta.
export const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] =
  [
    // Conversación / contacto (los despacha el webhook de entrada).
    { value: 'new_contact_created', label: 'automations.triggerNewContact' },
    { value: 'first_inbound_message', label: 'automations.triggerFirstInbound' },
    { value: 'new_message_received', label: 'automations.triggerNewMessage' },
    { value: 'keyword_match', label: 'automations.triggerKeywordMatch' },
    {
      value: 'conversation_assigned',
      label: 'automations.triggerConversationAssigned',
    },
    { value: 'tag_added', label: 'automations.triggerTagAdded' },
    {
      value: 'shopify_order_created',
      label: 'automations.triggerShopifyOrderCreated',
    },
    {
      value: 'shopify_order_paid',
      label: 'automations.triggerShopifyOrderPaid',
    },
    {
      value: 'shopify_order_confirmed',
      label: 'automations.triggerShopifyOrderConfirmed',
    },
    {
      value: 'shopify_order_fulfilled',
      label: 'automations.triggerShopifyOrderFulfilled',
    },
    {
      value: 'shopify_order_delivered',
      label: 'automations.triggerShopifyOrderDelivered',
    },
    {
      value: 'shopify_order_cancelled',
      label: 'automations.triggerShopifyOrderCancelled',
    },
    {
      value: 'shopify_order_refunded',
      label: 'automations.triggerShopifyOrderRefunded',
    },
    {
      value: 'shopify_abandoned_checkout',
      label: 'automations.triggerShopifyAbandonedCheckout',
    },
    { value: 'payment_rejected', label: 'automations.triggerPaymentRejected' },
    { value: 'payment_pending', label: 'automations.triggerPaymentPending' },
    {
      value: 'voice_call_completed',
      label: 'automations.triggerVoiceCallCompleted',
    },
  ]

// Nombres para los activadores que NO se ofrecen (heredados / por cron). Sin
// esto, editar una automatización con uno de ellos mostraba el enum crudo.
export const TRIGGER_LABEL_FALLBACK: Record<string, string> = {
  post_delivery_feedback: 'automations.triggerPostDeliveryFeedback',
  customer_inactive: 'automations.triggerCustomerInactive',
  keyword_match: 'automations.triggerKeywordMatch',
  time_based: 'automations.triggerTimeBased',
  new_message_received: 'automations.triggerNewMessage',
  first_inbound_message: 'automations.triggerFirstInbound',
  new_contact_created: 'automations.triggerNewContact',
  conversation_assigned: 'automations.triggerConversationAssigned',
}

/** El nombre de cualquier activador, incluidos los heredados. */
export function triggerLabel(
  type: AutomationTriggerType | string,
  t: TFn
): string {
  const opt = TRIGGER_OPTIONS.find((o) => o.value === type)
  if (opt) return t(opt.label)
  const fb = TRIGGER_LABEL_FALLBACK[type]
  return fb ? t(fb) : String(type)
}

/**
 * Activadores que SÓLO existen en Shopify.
 *
 * El camino de Tiendanube/WooCommerce (`lib/commerce/ingest.ts`) nunca emite
 * `shopify_order_confirmed`: lo empuja únicamente el webhook de Shopify, que es
 * el que sabe leer el pago acreditado y la confirmación de contraentrega. Una
 * automatización con ese activador filtrada a otra tienda queda muda para
 * siempre, así que hay que decirlo en pantalla en vez de dejarla fallar callada.
 */
export const TRIGGERS_SOLO_SHOPIFY = new Set<string>(['shopify_order_confirmed'])

export function activadorSoportado(
  type: AutomationTriggerType | string,
  plataforma: string | null
): boolean {
  if (!plataforma) return true
  if (plataforma === 'shopify') return true
  return !TRIGGERS_SOLO_SHOPIFY.has(String(type))
}
