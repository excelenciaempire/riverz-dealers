/** Reglas deterministas para una conversación entregada a Recuperación. */
export type RecoveryAction =
  | 'confirm_cod'
  | 'benefit'
  | 'manual_payment'
  | 'none';

const MANUAL_PAYMENT =
  /\b(transferencia|transferir|comprobante|bancolombia|nequi|llave|bold|addi)\b/i;

export function recoveryAction(input: {
  assignedOnly: boolean;
  text: string;
  benefitPercent?: unknown;
}): RecoveryAction {
  if (!input.assignedOnly) return 'none';

  const text = input.text.trim().normalize('NFC').toUpperCase();
  if (text === 'CONFIRMAR') return 'confirm_cod';
  if (MANUAL_PAYMENT.test(input.text)) return 'manual_payment';

  const benefit = Number(input.benefitPercent ?? 0);
  if (text === 'BENEFICIO' && (benefit === 5 || benefit === 10))
    return 'benefit';
  if (text === 'SI' && benefit === 10) return 'benefit';
  return 'none';
}

export function recoveryCheckoutAllowed(action: RecoveryAction): boolean {
  return action === 'benefit';
}
