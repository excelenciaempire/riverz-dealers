import { canonicalizePath } from '@/lib/i18n/routes';

/** Retired modules cannot be reached through old bookmarks, APIs or cron jobs. */
export const RETIRED_DEALER_ROUTES = [
  '/productos',
  '/pedidos',
  '/devoluciones',
  '/logistica',
  '/menus',
  '/operacion',
  '/chat',
  '/shopify',
  '/landing',
  '/calculadora',
  '/api/products',
  '/api/orders',
  '/api/devoluciones',
  '/api/logistics',
  '/api/flows',
  '/api/operacion',
  '/api/shopify',
  '/api/tiendanube',
  '/api/woocommerce',
  '/api/mercadopago',
  '/api/stores',
  '/api/hooks/klaviyo',
  '/api/internal/dropi',
  '/api/integrations/dropi',
  '/api/integrations/address-validation',
  '/api/integrations/klaviyo',
  '/api/integrations/mercadopago',
  '/api/integrations/meta-pixel',
  '/api/integrations/reviews',
  '/api/integrations/subscriptions',
  '/api/ai/tope-descuento',
  '/api/ai/reglas-de-cobro',
  '/api/ai/cobro-comprobante',
  '/api/webchat/install',
  '/api/webchat/knowledge',
  '/api/widget/orders',
  '/api/widget/product',
  '/api/widget/order-address-requests',
  '/api/admin/commerce-session',
  '/api/admin/woocommerce-plugin',
  '/admin/onboarding',
  '/admin/operacion',
  '/api/cron/contacts-sync',
  '/api/automations/tablero',
  '/automatizaciones/tablero',
  '/api/billing/shopify',
  '/api/admin/ops/shopify-check',
  '/api/cron/catalog-enrich',
  '/api/cron/commerce-webhooks',
  '/api/cron/conversion-retry',
  '/api/cron/delivery-watchdog',
  '/api/cron/dropi-incident-setup',
  '/api/cron/flows-resume',
  '/api/cron/klaviyo-sync',
  '/api/cron/mercadolibre',
  '/api/cron/mercadopago-recovery',
  '/api/cron/mercadopago-sync',
  '/api/cron/post-purchase-guides',
  '/api/cron/shopify-cart-recovery',
  '/api/cron/reengagement',
  '/api/ai/instagram-agent/attributed-orders',
  '/api/cron/shopify-feedback',
  '/api/cron/shopify-token-refresh',
  '/api/cron/tiendanube-checkouts',
  '/api/cron/tracking-evidence-setup',
] as const;

export function isRetiredDealerRoute(pathname: string): boolean {
  const path = canonicalizePath(pathname).replace(/\/$/, '');
  return (
    RETIRED_DEALER_ROUTES.some(
      (root) => path === root || path.startsWith(`${root}/`)
    ) ||
    /^\/api\/contacts\/[^/]+\/(?:commerce-link|enrich|purchases)(?:\/|$)/.test(
      path
    ) ||
    /^\/api\/conversations\/[^/]+\/(?:order|orders|order-actions|address-requests|subscriptions)(?:\/|$)/.test(
      path
    ) ||
    /^\/api\/(?:channels|connections)\/mercadolibre(?:\/|$)/.test(path)
  );
}

export const DEALER_AUTOMATION_TRIGGERS = new Set([
  'dealer_follow_up_due',
  'dealer_appointment_reminder',
  'dealer_no_show',
  'dealer_post_visit',
  'new_contact_created',
  'first_inbound_message',
  'new_message_received',
  'keyword_match',
  'conversation_assigned',
  'tag_added',
  'time_based',
  'voice_call_completed',
]);

export function isDealerAutomationTrigger(trigger: string): boolean {
  return DEALER_AUTOMATION_TRIGGERS.has(trigger);
}

const COMMERCE_FIELDS = new Set([
  'last_product',
  'last_offer_units',
  'last_offer_chosen',
  'is_shopify_customer',
  'shopify_data',
]);
const COMMERCE_VAR =
  /^(?:order(?:_|$)|checkout(?:_|$)|shipping(?:_|$)|tracking(?:_|$)|payment(?:_|$)|retention(?:_|$)|offer_(?:units|chosen)|total_price$|subtotal_price$|total_discounts$|item_count$|first_item$|financial_status$|fulfillment_status$)/;

/** Applies to saved legacy automations too, before a retired step can run. */
export function isRetiredDealerAutomationStep(step: {
  step_type: string;
  step_config: unknown;
}): boolean {
  const c = (step.step_config ?? {}) as Record<string, unknown>;
  if (step.step_type === 'condition') {
    if (
      ['purchased', 'rejected_open', 'order_paid'].includes(String(c.subject))
    )
      return true;
    if (c.subject === 'contact_field' && COMMERCE_FIELDS.has(String(c.operand)))
      return true;
    if (c.subject === 'context_var' && COMMERCE_VAR.test(String(c.operand)))
      return true;
  }
  if (
    step.step_type === 'update_contact_field' &&
    COMMERCE_FIELDS.has(String(c.field))
  )
    return true;
  if (
    step.step_type === 'set_context' &&
    c.values &&
    typeof c.values === 'object' &&
    Object.keys(c.values).some((key) => COMMERCE_VAR.test(key))
  )
    return true;
  const serialized = JSON.stringify(c);
  return /(?:\{\{\s*)?vars\.(order(?:_|\b)|checkout|shipping|tracking|payment|retention|offer_(?:units|chosen)|total_price|subtotal_price|total_discounts|item_count|first_item|financial_status|fulfillment_status)/.test(
    serialized
  );
}
