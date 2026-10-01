import { z } from 'zod';
import type { Locale } from '@/lib/i18n/config';
import { translateMessages, type TVars } from '@/lib/i18n/namespace';
import { webchat } from '@/lib/i18n/messages/webchat';

const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const cursor = z.object({ id: z.string().uuid(), created_at: timestamp }).strict();
export const visitorOrder = z.object({ id: z.string().uuid(), reference: z.string().trim().min(1).max(80), created_at: timestamp }).strict();
export const visitorOrderPage = z.object({ orders: z.array(visitorOrder).max(20), next_cursor: z.string().max(512).nullable() }).strict();
export type VisitorOrder = z.infer<typeof visitorOrder>;
export type VisitorOrderPage = z.infer<typeof visitorOrderPage>;
export const orderRequestAction = z.enum(['confirm', 'address', 'variant', 'cancel']);
export type OrderRequestAction = z.infer<typeof orderRequestAction>;

export function widgetOrderText(locale: Locale, key: string, vars?: TVars): string {
  return translateMessages(locale, webchat, key, vars);
}

export function parseVisitorOrderCursor(raw: string) {
  try { return cursor.parse(JSON.parse(raw)); }
  catch { throw new Error('visitor_order_invalid'); }
}

export function parseVisitorOrderQuery(raw: unknown) {
  const value = z.object({ locale: z.enum(['es', 'en']).default('es'), cursor: z.string().min(1).max(512).optional() }).strict().safeParse(raw);
  if (!value.success) throw new Error('visitor_order_invalid');
  if (value.data.cursor) parseVisitorOrderCursor(value.data.cursor);
  return value.data;
}

/** A customer request enters the existing chat pipeline. It is not proof that
 * an order was changed, confirmed, cancelled or financially approved. */
export function widgetOrderRequest(locale: Locale, order: VisitorOrder, action: OrderRequestAction, details: string): string | null {
  if (!visitorOrder.safeParse(order).success || !orderRequestAction.safeParse(action).success || details.length > 600) return null;
  const text = details.trim();
  if (action !== 'confirm' && !text) return null;
  const request = widgetOrderText(locale, `orderRequest_${action}`, { order: JSON.stringify(order.reference) });
  return action === 'confirm' ? request : `${request}\n${JSON.stringify(text)}`;
}
