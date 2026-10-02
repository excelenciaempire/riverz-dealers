import { z } from 'zod';
import { shippingAddress, type OrderShippingAddress } from '@/lib/shopify/shipping-address-contract';
import type { Locale } from '@/lib/i18n/config';
import { widgetOrderText } from './order-contract';

export const requestedAddress = z.unknown().transform((raw, ctx): OrderShippingAddress => {
  const value = shippingAddress(raw);
  if (!value) { ctx.addIssue({ code: 'custom', message: 'invalid_address_request' }); return z.NEVER; }
  return value;
});
export const addressRequestInput = z.object({
  id: z.string().uuid(), order_id: z.string().uuid(), address: requestedAddress,
  confirmed: z.literal(true), locale: z.enum(['es', 'en']),
}).strict();
export type AddressRequestInput = z.infer<typeof addressRequestInput>;
const at = z.string().datetime({ offset: true });
export const addressRequestReceipt = z.object({
  id: z.string().uuid(), reference: z.string().min(1).max(80), created_at: at,
  status: z.enum(['not_submitted', 'waiting_review', 'prepared', 'processing', 'confirmed', 'needs_review', 'not_completed', 'superseded']),
  confirmed_at: at.nullable(), superseded: z.boolean(),
}).strict().refine(value => (value.status === 'confirmed') === (value.confirmed_at !== null));
export type AddressRequestReceipt = z.infer<typeof addressRequestReceipt>;
export const caseAddressRequest = z.object({
  id: z.string().uuid(), order_id: z.string().uuid(), contact_id: z.string().uuid(), conversation_id: z.string().uuid(),
  reference: z.string().min(1).max(80), address: requestedAddress, created_at: at,
}).strict();
export const caseAddressRequestPage = z.object({ requests: z.array(caseAddressRequest).max(20) }).strict();
export const prepareAddressRequestInput = z.object({ id: z.string().uuid(), request_id: z.string().uuid() }).strict();
/** Stable text becomes a real customer message through the existing pipeline.
 * The receipt separately distinguishes message persistence from order execution. */
export function addressRequestMessage(locale: Locale, reference: string, address: OrderShippingAddress) {
  return `${widgetOrderText(locale, 'orderRequest_address', { order: JSON.stringify(reference) })}\n${JSON.stringify(address)}`;
}
