import { createHash } from 'node:crypto';

/** Payment must be settled. A COD order instead needs an explicit order tag. */
export function orderConfirmationReason(
  order: Record<string, unknown>,
  confirmedTag = 'Confirmado'
): 'paid' | 'cod_confirmed' | null {
  const status = String(order.financial_status ?? '').toLowerCase();
  if (
    order.cancelled_at ||
    ['refunded', 'partially_refunded', 'voided'].includes(status)
  )
    return null;
  if (status === 'paid') return 'paid';
  const gateways = Array.isArray(order.payment_gateway_names)
    ? order.payment_gateway_names.map(String)
    : [String(order.gateway ?? '')];
  const cod = gateways.some((gateway) =>
    /cash[ _-]*on[ _-]*delivery|contra[ _-]*entrega|pago[ _-]*al[ _-]*recibir|^cod$/i.test(
      gateway.trim()
    )
  );
  const tags = (
    Array.isArray(order.tags)
      ? order.tags.map(String)
      : String(order.tags ?? '').split(',')
  ).map((t) => t.trim().toLowerCase());
  if (tags.some((tag) => ['cancelado', 'cancelled', 'canceled'].includes(tag)))
    return null;
  return cod &&
    confirmedTag.trim() &&
    tags.includes(confirmedTag.trim().toLowerCase())
    ? 'cod_confirmed'
    : null;
}

/** Same order + same automation always claim the same log, including retries. */
export function confirmedOrderLogId(
  workspace: string,
  automation: string,
  order: string
): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify(['confirmed-order-v1', workspace, automation, order])
    )
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
