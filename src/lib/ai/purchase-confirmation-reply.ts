/** A confirmation button completes the data check; it must not restart sales.
 * Scoped to the merchant's existing order handoff, never cart recovery.
 */
export function purchaseConfirmationReply(input: {
  workspaceId: string;
  language: string | null;
  text: string;
  context: Record<string, unknown> | null;
}): string | null {
  const c = input.context;
  if (input.workspaceId !== '36f81b96-41b9-4d29-b72e-11be3d3070a3' || !c ||
    c.retention_handoff || c.checkout_url || c.benefit_percent ||
    !String(c.order_id ?? '').trim() || !String(c.order_items ?? '').trim() ||
    c.order_items === '—' || !String(c.delivery_address ?? '').trim()) return null;
  const action = input.text.trim().toUpperCase();
  const en = input.language?.toLowerCase().startsWith('en');
  if (action === 'CONFIRMAR' || action === 'CONFIRM') {
    return en
      ? 'Thank you for confirming your details and for your purchase! If you have any questions, you can message us here.'
      : '¡Gracias por confirmar tus datos y por tu compra! Si tienes alguna pregunta, puedes escribirnos por aquí.';
  }
  if (action === 'CORREGIR' || action === 'CORRECT') {
    return en ? 'Which order detail would you like to change?' : '¿Qué dato de tu pedido necesitas corregir?';
  }
  return null;
}
