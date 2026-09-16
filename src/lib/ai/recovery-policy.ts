/** Reglas deterministas para una conversación entregada a Recuperación. */
export type RecoveryAction =
  | 'confirm_cod'
  | 'benefit'
  | 'payment_options'
  | 'manual_payment'
  | 'none';

const PAYMENT_TOPIC =
  /\b(transferencia|transferir|bancolombia|nequi|llave|bold|addi)\b/i;
const MANUAL_PAYMENT =
  /\b(comprobante|ya\s+(?:pagué|pague|transferí|transferi)|pago\s+(?:hecho|realizado)|cobro\s+(?:doble|duplicado))\b/i;

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
  const button = recoveryButtonKind(text);
  if (button === 'confirm') return 'confirm_cod';
  if (button === 'payment_change' && input.existingOrder) return 'payment_options';
  if (MANUAL_PAYMENT.test(input.text)) return 'manual_payment';

  const benefit = Number(input.benefitPercent ?? 0);
  const requestedBenefit =
    (text === 'BENEFICIO' || text === 'RECIBIR BENEFICIO') &&
    (benefit === 5 || benefit === 10);
  // En un pedido que ya existe, esos botones no abren una venta nueva:
  // solicitan cambiar la forma de pago del pedido actual. Un cupón personal
  // para "la próxima compra" no aplica y además deja el pedido intacto.
  if (requestedBenefit) return 'benefit';
  if (PAYMENT_TOPIC.test(input.text)) return 'payment_options';
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

/**
 * Importes que el agente puede citar en una recuperación con pedido: el
 * total y el subtotal tal como vienen de la tienda, y cada uno con el
 * beneficio anunciado aplicado (5% ó 10%), en las tres formas de redondear
 * que puede elegir el modelo. Sin pedido o sin importe, nada.
 */
export function preciosDelPedidoEnRecuperacion(
  context: Record<string, unknown> | null | undefined
): number[] {
  if (!context || !recoveryHasExistingOrder(context)) return [];
  const importes = new Set<number>();
  for (const clave of ['total_price', 'subtotal_price']) {
    const n = Number(String(context[clave] ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) importes.add(n);
  }
  const beneficio = Number(context.benefit_percent ?? 0);
  if (beneficio > 0 && beneficio < 100) {
    for (const base of [...importes]) {
      const conDescuento = base * (1 - beneficio / 100);
      importes.add(Math.round(conDescuento));
      importes.add(Math.floor(conDescuento));
      importes.add(Math.ceil(conDescuento));
      importes.add(Math.round(conDescuento * 100) / 100);
    }
  }
  return [...importes];
}
