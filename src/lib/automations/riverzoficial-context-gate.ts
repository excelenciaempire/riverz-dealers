import type { SupabaseClient } from '@supabase/supabase-js';
import { RIVERZOFICIAL_WORKSPACE } from './riverzoficial-template-context';
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags';
import { confirmationSummary } from '@/lib/shopify/confirmation-summary';
import { orderConfirmationReason } from './order-confirmation';
import { DEUNA_TRACKING_REMINDER_AUTOMATION_ID } from './deuna-tracking-reminder';
/** Automatización → qué verifica en Shopify antes de cada mensaje. Lo usa también la prueba como cliente. */
export const RIVERZ_FLOWS: Record<string, string> = {
  'f29f3d74-f10f-42a5-946a-15b254a70106': 'confirmation',
  'f1784d9c-3c26-4328-83af-9454efb0864d': 'cart',
  '7aebb961-1207-4ad2-be03-11580e1de813': 'shipped',
  [DEUNA_TRACKING_REMINDER_AUTOMATION_ID]: 'shipped',
  '7e831f94-51c2-4c58-ba80-a8a640623abf': 'delivered',
  'a56108d1-5998-429d-a453-2fe69a3e7132': 'cancelled',
};
export function riverzOrderSkipReason(kind: string, order: Record<string, unknown>): string | null {
  const cancelled = Boolean(order.cancelled_at) || ['refunded','partially_refunded','voided'].includes(String(order.financial_status));
  const fulfillments = (Array.isArray(order.fulfillments) ? order.fulfillments : []) as Record<string, unknown>[];
  const valid = fulfillments.filter(f=>f.status!=='cancelled' && f.status!=='failure' && f.status!=='error');
  const delivered = valid.length > 0 && valid.every(f=>f.shipment_status==='delivered') && order.fulfillment_status==='fulfilled';
  const shipped = valid.some(f=>Boolean(f.tracking_number)||Boolean((f.tracking_numbers as unknown[]|undefined)?.length));
  if(kind==='cancelled') return cancelled ? null : 'cancellation_not_verified';
  if(cancelled) return 'order_cancelled_or_refunded';
  if(kind==='confirmation') {
    if(orderConfirmationReason(order)) return 'order_already_confirmed_or_paid';
    if(shipped || delivered || ['fulfilled','partial'].includes(String(order.fulfillment_status))) return 'order_already_in_fulfillment';
  }
  if(kind==='shipped') return delivered ? 'already_delivered' : shipped ? null : 'tracking_not_verified';
  if(kind==='delivered') return delivered ? null : 'delivery_not_verified';
  return null;
}
async function manualTracking(db: SupabaseClient, workspaceId: string, orderId: string)
  : Promise<{ tracking_number: string; tracking_company: string|null }|null> {
  const {data,error}=await db.from('orders').select('tracking_number,tracking_company')
    .eq('workspace_id',workspaceId).eq('shopify_order_id',orderId).eq('tracking_source','manual')
    .neq('status','cancelled').limit(1).maybeSingle();
  if(error||!data?.tracking_number)return null;
  return data as { tracking_number: string; tracking_company: string|null };
}
/** Re-evaluate the actual transaction after every wait, before messages or calls.
 * Returning a reason closes this scope as skipped; unavailable evidence never sends.
 */
export async function riverzFlowSkipReason(db: SupabaseClient, input: {
  workspaceId: string; automationId: string; contactId: string|null;
  logId: string|null; resumed: boolean; vars: Record<string,unknown>;
}, fetcher: typeof fetch = fetch): Promise<string|null> {
  if(input.workspaceId!==RIVERZOFICIAL_WORKSPACE || !RIVERZ_FLOWS[input.automationId]) return null;
  const kind=RIVERZ_FLOWS[input.automationId];
  if((kind==='confirmation'||kind==='cart') && input.resumed) {
    if(!input.contactId||!input.logId)return 'missing_conversation_context';
    const {data:log,error:le}=await db.from('automation_logs').select('created_at').eq('id',input.logId).eq('workspace_id',input.workspaceId).maybeSingle();
    if(le||!log?.created_at)return 'conversation_context_unavailable';
    const {data:conversations,error:ce}=await db.from('conversations').select('id').eq('workspace_id',input.workspaceId).eq('contact_id',input.contactId);
    if(ce)return 'conversation_context_unavailable';
    const ids=(conversations??[]).map(c=>c.id);
    if(ids.length){
      const reply=await db.from('messages').select('id',{count:'exact',head:true}).in('conversation_id',ids).eq('sender_type','customer').gt('created_at',log.created_at);
      if(reply.error)return 'reply_state_unavailable';
      if(reply.count)return 'customer_already_replied';
      const recent=await db.from('messages').select('id',{count:'exact',head:true}).in('conversation_id',ids).in('sender_type',['agent','bot']).gt('created_at',new Date(Date.now()-5*60_000).toISOString());
      if(recent.error)return 'conversation_state_unavailable';
      if(recent.count)return 'conversation_in_progress';
    }
  }
  if(kind==='cart') {
    if(!input.vars.checkout_url)return 'missing_checkout';
    const {data:cart,error}=await db.from('shopify_checkouts').select('line_items,completed_at,checkout_id').eq('workspace_id',input.workspaceId).eq('abandoned_checkout_url',String(input.vars.checkout_url)).limit(1).maybeSingle();
    if(error||!cart)return 'checkout_unavailable';
    if(cart.completed_at)return 'checkout_completed';
    const items=confirmationSummary({line_items:cart.line_items}).order_items;
    if(items==='—')return 'checkout_empty';
    input.vars.order_items=items;
    // Purchase conditions in the visible flow additionally query the store live.
    return null;
  }
  const orderId=String(input.vars.order_id??'');
  if(!/^\d+$/.test(orderId))return 'missing_order';
  const admin=await resolveShopifyAdmin(db,input.workspaceId);
  if(!admin || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(admin.shopDomain))return 'order_connection_unavailable';
  try {
    const response=await fetcher(`https://${admin.shopDomain}/admin/api/${admin.apiVersion}/orders/${orderId}.json?fields=id,cancelled_at,financial_status,fulfillment_status,payment_gateway_names,tags,line_items,shipping_address,phone,total_price,currency,fulfillments`,{headers:{'X-Shopify-Access-Token':admin.accessToken},signal:AbortSignal.timeout(15_000),cache:'no-store'});
    if(!response.ok)return 'order_state_unavailable';
    const {order}=await response.json();
    if(!order||String(order.id)!==orderId)return 'order_identity_mismatch';
    let reason=riverzOrderSkipReason(kind,order);
    // La app logística a veces no sincroniza la guía con Shopify. La que el
    // comercio cargó a mano en Riverz es la misma evidencia, así que vale.
    const manual=reason==='tracking_not_verified'?await manualTracking(db,input.workspaceId,orderId):null;
    if(manual)reason=null;
    if(reason)return reason;
    const summary=confirmationSummary(order);
    if(summary.order_items==='—')return 'order_items_unavailable';
    Object.assign(input.vars,summary,{total_price:String(order.total_price??''),currency:order.currency??''});
    if(manual){
      input.vars.tracking_number=manual.tracking_number;
      input.vars.tracking_company=manual.tracking_company??'';
    } else if(kind==='shipped'){
      const fulfillment=(order.fulfillments??[]).find((f:Record<string,unknown>)=>f.status!=='cancelled'&&f.status!=='failure'&&f.status!=='error'&&(f.tracking_number||(Array.isArray(f.tracking_numbers)&&f.tracking_numbers.length)));
      input.vars.tracking_number=fulfillment?.tracking_number??fulfillment?.tracking_numbers?.[0]??'';
      input.vars.tracking_company=fulfillment?.tracking_company??'';
    }
    return null;
  } catch {return 'order_state_unavailable';}
}
