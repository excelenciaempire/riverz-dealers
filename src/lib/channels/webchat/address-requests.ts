import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { WebchatSession } from './token';
import { addressRequestInput, addressRequestReceipt, addressRequestMessage, caseAddressRequestPage, prepareAddressRequestInput, type AddressRequestInput } from './address-request-contract';
import { caseOrderSnapshot } from '@/lib/inbox/order-actions';
import { assertWorkspaceWritable } from '@/lib/billing/read-only';
import { limitByKey } from '@/lib/rate-limit';

export class AddressRequestError extends Error {
  constructor(readonly code: 'invalid' | 'notFound' | 'changed' | 'pending' | 'limited' | 'readOnly' | 'unavailable') { super(code); }
}
function failure(message: string): never {
  const codes: Record<string, AddressRequestError['code']> = { invalid_address_request: 'invalid', address_request_not_found: 'notFound', address_request_changed: 'changed',
    address_request_pending: 'pending', address_request_limit: 'limited', subscription_read_only: 'readOnly', order_action_conflict: 'changed' };
  throw new AddressRequestError(codes[message] ?? 'unavailable');
}
function sessionArgs(session: WebchatSession, connectionId: string, id: string) {
  if (![session.workspaceId, connectionId, id].every(value => z.string().uuid().safeParse(value).success) || !session.visitorId || session.visitorId.length > 200) throw new AddressRequestError('invalid');
  return { p_workspace_id: session.workspaceId, p_connection_id: connectionId, p_visitor_id: session.visitorId, p_id: id };
}
function receipt(raw: unknown, id: string) {
  const value = addressRequestReceipt.safeParse(raw);
  if (!value.success || value.data.id !== id) throw new AddressRequestError('unavailable');
  return value.data;
}
export async function readAddressRequestReceipt(db: SupabaseClient, session: WebchatSession, connectionId: string, id: string) {
  const result = await db.rpc('read_webchat_address_receipt', sessionArgs(session, connectionId, id));
  if (result.error) failure(result.error.message);
  return receipt(result.data, id);
}
/** Reserve before ingress; a retry retains its external message ID and cannot
 * replace the stored visitor, target or address. No provider or model is called. */
export async function reserveAddressRequest(db: SupabaseClient, session: WebchatSession, connectionId: string, raw: AddressRequestInput) {
  const parsed = addressRequestInput.safeParse(raw);
  if (!parsed.success) throw new AddressRequestError('invalid');
  const input = parsed.data, args = sessionArgs(session, connectionId, input.id);
  const contact = await db.rpc('webchat_address_visitor_contact', { p_workspace_id: session.workspaceId, p_connection_id: connectionId, p_visitor_id: session.visitorId });
  if (contact.error || !z.string().uuid().safeParse(contact.data).success) throw new AddressRequestError('notFound');
  const order = await db.from('orders').select('order_number').eq('id', input.order_id).eq('workspace_id', session.workspaceId).eq('contact_id', contact.data).eq('platform', 'shopify').maybeSingle();
  if (order.error) throw new AddressRequestError('unavailable');
  const reference = z.string().min(1).max(80).safeParse(order.data?.order_number);
  if (!reference.success) throw new AddressRequestError('notFound');
  const text = addressRequestMessage(input.locale, reference.data, input.address);
  const result = await db.rpc('reserve_webchat_address_request', { ...args, p_order_id: input.order_id, p_address: input.address, p_message: text });
  if (result.error) failure(result.error.message);
  return { receipt: receipt(result.data, input.id), text };
}
export async function submitAddressRequest(db: SupabaseClient, session: WebchatSession, connectionId: string, id: string) {
  const result = await db.rpc('submit_webchat_address_request', sessionArgs(session, connectionId, id));
  if (result.error) failure(result.error.message);
  return receipt(result.data, id);
}
export async function readCaseAddressRequests(db: SupabaseClient, workspaceId: string, actorId: string, conversationId: string, orderId: string) {
  if (![workspaceId, actorId, conversationId, orderId].every(value => z.string().uuid().safeParse(value).success)) throw new AddressRequestError('invalid');
  const result = await db.rpc('read_case_address_requests', { p_workspace_id: workspaceId, p_actor_id: actorId, p_conversation_id: conversationId, p_order_id: orderId });
  if (result.error) failure(result.error.message);
  const page = caseAddressRequestPage.safeParse(result.data);
  if (!page.success || page.data.requests.some(value => value.order_id !== orderId || value.conversation_id !== conversationId)) throw new AddressRequestError('unavailable');
  return page.data;
}
/** Prepare the same snapshot/operation reviewed by the existing administrator.
 * The visitor is never impersonated as a workspace member. */
export async function prepareCaseAddressRequest(db: SupabaseClient, workspaceId: string, actorId: string, conversationId: string, orderId: string, raw: unknown) {
  const input = prepareAddressRequestInput.safeParse(raw);
  if (!input.success) throw new AddressRequestError('invalid');
  const page = await readCaseAddressRequests(db, workspaceId, actorId, conversationId, orderId);
  const request = page.requests.find(value => value.id === input.data.request_id);
  if (!request) throw new AddressRequestError('changed');
  const args = { p_workspace_id: workspaceId, p_actor_id: actorId, p_conversation_id: conversationId, p_request_id: request.id, p_id: input.data.id };
  const recovered = await db.rpc('prepare_webchat_address_preview', { ...args, p_preview: null, p_fingerprint: null });
  if (recovered.error) failure(recovered.error.message);
  const parsePrepared = (raw: unknown) => {
    const value = z.object({ operation_id: z.string().uuid(), order_id: z.string().uuid(), request_id: z.string().uuid() }).strict().safeParse(raw);
    if (!value.success || value.data.operation_id !== input.data.id || value.data.order_id !== orderId || value.data.request_id !== request.id) throw new AddressRequestError('unavailable');
    return value.data;
  };
  if (recovered.data !== null) return parsePrepared(recovered.data);
  try { await assertWorkspaceWritable(db, workspaceId); } catch { throw new AddressRequestError('readOnly'); }
  if (!(await limitByKey(`webchat-address-preview:${workspaceId}:${actorId}`, { limit: 30, windowMs: 60_000 })).success) throw new AddressRequestError('limited');
  let snapshot: Awaited<ReturnType<typeof caseOrderSnapshot>>;
  try { snapshot = await caseOrderSnapshot(db, workspaceId, request.contact_id, orderId, { type: 'address', address: request.address, reason: 'webchat_address_request' }); }
  catch { throw new AddressRequestError('unavailable'); }
  const result = await db.rpc('prepare_webchat_address_preview', { ...args, p_preview: snapshot.preview, p_fingerprint: snapshot.fingerprint });
  if (result.error) failure(result.error.message);
  return parsePrepared(result.data);
}
