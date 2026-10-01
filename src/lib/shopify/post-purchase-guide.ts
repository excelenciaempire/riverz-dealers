import { createHash } from 'node:crypto';

export interface GuideRule {
  guide_product_id: string;
  qualifying_product_id: string;
  minimum_quantity: number;
  enabled_at: string;
}
export interface GuideOrder {
  id: string | number;
  name?: string;
  created_at: string;
  financial_status: string;
  cancelled_at?: string | null;
  test?: boolean;
  email?: string | null;
  contact_email?: string | null;
  line_items: Array<{
    product_id?: string | number;
    quantity: number;
    current_quantity?: number;
  }>;
}

/** Only new, paid, non-test purchases that still contain the promised gift. */
export function qualifiesForGuide(order: GuideOrder, rule: GuideRule): boolean {
  const created = Date.parse(order.created_at);
  if (
    !Number.isFinite(created) ||
    created < Date.parse(rule.enabled_at) ||
    order.cancelled_at ||
    order.test ||
    order.financial_status !== 'paid'
  )
    return false;
  const quantity = (item: GuideOrder['line_items'][number]) =>
    Math.max(0, item.current_quantity ?? item.quantity);
  const gift = order.line_items.some(
    (item) =>
      String(item.product_id) === rule.guide_product_id && quantity(item) > 0
  );
  const bottles = order.line_items
    .filter((item) => String(item.product_id) === rule.qualifying_product_id)
    .reduce((sum, item) => sum + quantity(item), 0);
  return gift && bottles >= rule.minimum_quantity;
}

export function guideRecipient(order: GuideOrder): string | null {
  const email = (order.email || order.contact_email || '').trim();
  return /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)
    ? email
    : null;
}

/** Stable delivery identity; Gmail may rewrite the RFC Message-ID on send. */
export function guideMessageId(guideId: string, orderId: string): string {
  return `riverz-guide-${createHash('sha256').update(`${guideId}:${orderId}`).digest('hex')}@riverzai.com`;
}

export function guideSendFailure(
  status: number,
  attempts: number
): 'pending' | 'failed' | 'uncertain' {
  if ([401, 403, 429].includes(status))
    return attempts < 4 ? 'pending' : 'failed';
  if ([400, 404, 413, 422].includes(status)) return 'failed';
  return 'uncertain';
}

export function guideEmailRaw(args: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
}): string {
  if (
    [args.from, args.to, args.subject, args.messageId].some((value) =>
      /[\r\n]/.test(value)
    )
  )
    throw new Error('invalid_email_header');
  return Buffer.from(
    [
      `From: ${args.from}`,
      `To: ${args.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(args.subject).toString('base64')}?=`,
      `Message-ID: <${args.messageId}>`,
      `X-Riverz-Guide-Delivery: ${args.messageId}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      'Auto-Submitted: auto-generated',
      '',
      Buffer.from(args.body).toString('base64'),
    ].join('\r\n')
  ).toString('base64url');
}
