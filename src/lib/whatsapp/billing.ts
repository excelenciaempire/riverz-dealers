/**
 * WhatsApp Cloud API billing / payment-method helpers.
 *
 * Pure functions, no server deps — safe to import from client components.
 *
 * Meta blocks *business-initiated* conversations (templates) when the WABA
 * has no valid payment method (Graph health_status error 141006). The fix is
 * merchant-side: add a card in WhatsApp Manager → Configuración → Métodos de
 * pago. We can't do it for them, so we surface a direct link per WABA.
 */

/** Graph error code for "there is an error with the payment method". */
export const WA_PAYMENT_ERROR_CODE = 141006;

/**
 * Deep link to the place where a merchant adds/fixes the WhatsApp payment
 * method. When we know the WABA id we land them straight in their WhatsApp
 * Manager (billing lives under Configuración → Métodos de pago); otherwise we
 * fall back to the generic Meta billing hub.
 */
export function whatsappPaymentUrl(wabaId?: string | null): string {
  return wabaId
    ? `https://business.facebook.com/wa/manage/home?waba_id=${encodeURIComponent(wabaId)}`
    : "https://business.facebook.com/billing_hub/payment_settings";
}

/** True when a Meta/WhatsApp send error is the payment-method block (141006). */
export function isPaymentMethodError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const code = o.code ?? (o.error as Record<string, unknown> | undefined)?.code;
    if (Number(code) === WA_PAYMENT_ERROR_CODE) return true;
  }
  return String((err as { message?: string })?.message ?? err).includes(
    String(WA_PAYMENT_ERROR_CODE),
  );
}
