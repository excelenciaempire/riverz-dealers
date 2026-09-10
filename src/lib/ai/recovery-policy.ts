/** Reglas deterministas para una conversación entregada a Recuperación. */
export type RecoveryAction =
  | 'confirm_cod'
  | 'benefit'
  | 'manual_payment'
  | 'none';

const MANUAL_PAYMENT =
  /\b(transferencia|transferir|comprobante|bancolombia|nequi|llave|bold|addi)\b/i;

function normalizedButton(text: string): string {
  return text.trim().normalize('NFC').toUpperCase();
}

export function recoveryButtonKind(
  text: string
): 'confirm' | 'payment_change' | null {
  const normalized = normalizedButton(text);
  if (normalized === 'CONFIRMAR' || normalized === 'MANTENER CONTRAENTREGA') {
    return 'confirm';
  }
  if (normalized === 'BENEFICIO' || normalized === 'RECIBIR BENEFICIO') {
    return 'payment_change';
  }
  return null;
}

export function recoveryButtonReply(
  kind: NonNullable<ReturnType<typeof recoveryButtonKind>>,
  language?: string | null
): string {
  const english = language?.toLowerCase().startsWith('en');

  if (kind === 'confirm') {
    return english
      ? 'Thank you for your purchase! Your order has been confirmed and will be dispatched soon. If you have any questions, you can message us here.'
      : '¡Gracias por tu compra! Tu pedido ha sido confirmado y pronto será despachado. Si tienes alguna pregunta, puedes escribirnos por este medio.';
  }

  return english
    ? 'Which payment method do you prefer? Our team will help you continue here.'
    : '¿Qué método de pago prefieres? Nuestro equipo te ayudará a continuar por este medio.';
}

export function recoveryButtonLosesToConfirmation(input: {
  currentText: string;
  competingText: string;
  existingOrder: boolean;
}): boolean {
  return (
    input.existingOrder &&
    recoveryButtonKind(input.currentText) === 'payment_change' &&
    recoveryButtonKind(input.competingText) === 'confirm'
  );
}

export function recoveryAction(input: {
  assignedOnly: boolean;
  text: string;
  benefitPercent?: unknown;
  existingOrder?: boolean;
}): RecoveryAction {
  if (!input.assignedOnly) return 'none';

  const text = normalizedButton(input.text);
  if (recoveryButtonKind(text) === 'confirm') return 'confirm_cod';
  if (MANUAL_PAYMENT.test(input.text)) return 'manual_payment';

  const benefit = Number(input.benefitPercent ?? 0);
  const requestedBenefit =
    (text === 'BENEFICIO' || text === 'RECIBIR BENEFICIO') &&
    (benefit === 5 || benefit === 10);
  // En un pedido que ya existe, esos botones no abren una venta nueva:
  // solicitan cambiar la forma de pago del pedido actual. Un cupón personal
  // para "la próxima compra" no aplica y además deja el pedido intacto.
  if (requestedBenefit && input.existingOrder) return 'manual_payment';
  if (requestedBenefit) return 'benefit';
  return 'none';
}

/**
 * Contexto de una recuperación que ya tiene un pedido concreto detrás.
 * Las integraciones históricas no usan siempre la misma clave, por eso se
 * aceptan los tres identificadores que ya llegan desde los disparadores.
 */
export function recoveryHasExistingOrder(
  context: Record<string, unknown> | null | undefined
): boolean {
  if (!context) return false;
  return Boolean(
    String(context.order_id ?? '').trim() ||
    String(context.order_number ?? '').trim() ||
    String(context.order_name ?? '').trim()
  );
}

export function recoveryCheckoutAllowed(action: RecoveryAction): boolean {
  return action === 'benefit';
}
