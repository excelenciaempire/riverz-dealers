import { detectAutomatedSender } from '@/lib/channels/email/automated-sender';

/** Conservative, free gate: only customer inquiries may trigger the email redirect. */
export function customerEmailDisposition(input: {
  workspaceId: string; channel: string; from?: string | null;
  subject?: string | null; text?: string | null; alreadyRedirected?: boolean; preventRepeatedRedirects?: boolean;
}): 'customer' | 'ignore' | 'review' | null {
  if (!['gmail', 'outlook', 'zoho'].includes(input.channel)) return null;
  if (detectAutomatedSender(input).automated) return 'ignore';
  const from = (input.from ?? '').toLowerCase();
  if (/@(?:[\w-]+\.)*(?:shopifyemail\.com|shopify\.com|stripe\.com|facebookmail\.com|intercom-mail\.com|judge\.me)\b/.test(from) ||
      /^(?:invoice|upcoming-invoice|receipt|newsletter|marketing)(?:[+@.-])/.test(from)) return 'ignore';
  // Inspect only what the sender wrote, never the Shopify notification they quoted.
  const text = (input.text ?? '').split(/\n\s*(?:>|El .{0,180}escribi[oó]:|On .{0,180}wrote:|_{5,}|-{3,}\s*(?:Forwarded|Mensaje reenviado)|From:|De:)/i)[0]
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!text) return 'review';
  if (/^(?:(?:hola|buenos dias)[!.,\s]*)?(?:ok|recibido|si[ ,]+(?:me )?llego(?: perfecto| en perfecto estado)?|muchas gracias|gracias(?: por (?:la )?(?:respuesta|informacion))?|thanks(?: a lot)?|thank you|received|got it)[.!\s]*$/i.test(text)) return 'ignore';
  if (/unsubscribe|cancelar suscripcion|no responda|do not reply|este (?:mail|correo).*automatic|receipt from|recibo de|subscription.*renew|newsletter|compradores activos|generar.{0,30}pedidos|comision.{0,25}(?:ventas|pedidos)|performance.based partnerships|promocionar tus productos/i.test(text)) return 'ignore';
  if (/representante legal|carta documento|coprec|notificarle formalmente|legal representative|formal legal notice/i.test(text)) return 'review';
  // A repeat inquiry is not resolved by sending the same link again.
  if (input.preventRepeatedRedirects !== false && (input.alreadyRedirected ||
      /(?:ya|tambien|already|also).{0,65}(?:escrib|envi|mande|contact|mensaje|messag|wrot|sent).{0,45}(?:whats|wsp|wasap)/i.test(text))) return 'review';
  if (/pedido|compra|compre|comprar|precio|cuanto|envio|entrega|lleg[oa]|recib[ií]|recibi|devolucion|reembolso|direccion|domicilio|tratamiento|shampoo|champu|producto|pago|pague|transfer|descuento|cupon|seguimiento|guia|order|delivery|refund|purchase|shipping|price/i.test(text)) return 'customer';
  if (/^#?\d{3,10}$/.test(text) && /pedido|order/i.test(input.subject ?? '')) return 'customer';
  // Unknown personal mail is left for review, not treated as consent for a robot reply.
  return 'review';
}

/** Compatibility for callers that have not migrated to workspace policy yet. */
export const revitalyEmailDisposition = customerEmailDisposition;
