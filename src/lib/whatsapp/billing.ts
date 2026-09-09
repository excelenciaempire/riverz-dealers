/**
 * WhatsApp Cloud API billing / payment-method helpers.
 *
 * Pure functions, no server deps — safe to import from client components.
 *
 * Meta blocks *business-initiated* conversations (templates) when the WABA
 * has no valid payment method (Graph health_status error 141006). The fix is
 * merchant-side: add a card in Meta Billing & payments. We can't do it for
 * them, so we surface a direct link to the payment account when its ids are
 * available on the connection.
 */

/** Graph error code for "there is an error with the payment method". */
export const WA_PAYMENT_ERROR_CODE = 141006;

/**
 * Deep link to the Meta payment account that owns the WhatsApp asset. The
 * billing hub needs both ids to select the right account; the business id
 * keeps the correct Business Portfolio selected when a person administers
 * more than one. Without a payment-account id, open the selected WABA in
 * WhatsApp Manager instead of letting Billing reuse an unrelated account.
 */
export function whatsappPaymentUrl(config?: {
  wabaId?: string | null;
  paymentAccountId?: string | null;
  businessId?: string | null;
}): string {
  const wabaId = config?.wabaId?.trim();
  const paymentAccountId = config?.paymentAccountId?.trim();
  const businessId = config?.businessId?.trim();

  const url = new URL(
    wabaId && paymentAccountId
      ? 'https://business.facebook.com/latest/billing_hub/accounts/details/'
      : wabaId
        ? 'https://business.facebook.com/latest/whatsapp_manager/overview/'
        : 'https://business.facebook.com/latest/billing_hub/payment_settings'
  );
  if (wabaId && paymentAccountId) url.searchParams.set('payment_account_id', paymentAccountId);
  if (wabaId) url.searchParams.set('asset_id', wabaId);
  if (businessId) url.searchParams.set('business_id', businessId);
  return url.toString();
}

/** True when a Meta/WhatsApp send error is the payment-method block (141006). */
export function isPaymentMethodError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const code =
      o.code ?? (o.error as Record<string, unknown> | undefined)?.code;
    if (Number(code) === WA_PAYMENT_ERROR_CODE) return true;
  }
  return String((err as { message?: string })?.message ?? err).includes(
    String(WA_PAYMENT_ERROR_CODE)
  );
}
