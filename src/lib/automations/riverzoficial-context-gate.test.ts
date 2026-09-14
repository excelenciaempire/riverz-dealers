import {describe,it,expect,vi,beforeEach} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('@/lib/shopify/order-tags',()=>({resolveShopifyAdmin:vi.fn(async()=>({shopDomain:'shop.myshopify.com',apiVersion:'2026-07',accessToken:'test-token'}))}));
import {riverzFlowSkipReason,riverzOrderSkipReason} from './riverzoficial-context-gate';
import {RIVERZOFICIAL_WORKSPACE} from './riverzoficial-template-context';
const confirmation='f29f3d74-f10f-42a5-946a-15b254a70106';
const cart='f1784d9c-3c26-4328-83af-9454efb0864d';
const input=()=>({workspaceId:RIVERZOFICIAL_WORKSPACE,automationId:confirmation,contactId:'contact',logId:'log',resumed:false,vars:{order_id:'123'} as Record<string,unknown>});
function database(responses:Record<string,unknown>[]){const q:Record<string,ReturnType<typeof vi.fn>>={};for(const key of ['select','eq','in','gt','limit'])q[key]=vi.fn(()=>q);q.maybeSingle=vi.fn(()=>Promise.resolve(responses.shift()));q.then=vi.fn((resolve: (v:unknown)=>unknown)=>Promise.resolve(responses.shift()).then(resolve));return {db:{from:vi.fn(()=>q)} as unknown as SupabaseClient,q};}
beforeEach(()=>vi.clearAllMocks());
describe('context of riverzoficial automations',()=>{
  it.each([
    [{cancelled_at:'now'},'order_cancelled_or_refunded'],
    [{financial_status:'refunded'},'order_cancelled_or_refunded'],
    [{financial_status:'paid'},'order_already_confirmed_or_paid'],
    [{payment_gateway_names:['Cash on Delivery'],tags:'Confirmado'},'order_already_confirmed_or_paid'],
    [{fulfillment_status:'partial'},'order_already_in_fulfillment'],
    [{fulfillments:[{status:'success',tracking_number:'ABC'}]},'order_already_in_fulfillment'],
  ])('stops confirmation when it no longer applies: %j',(order,reason)=>expect(riverzOrderSkipReason('confirmation',order)).toBe(reason));
  it('distinguishes dispatched, delivered and cancelled instead of upselling every event',()=>{
    expect(riverzOrderSkipReason('shipped',{fulfillments:[]})).toBe('tracking_not_verified');
    expect(riverzOrderSkipReason('shipped',{fulfillments:[{status:'cancelled',tracking_number:'ABC'}]})).toBe('tracking_not_verified');
    expect(riverzOrderSkipReason('delivered',{fulfillment_status:'fulfilled',fulfillments:[{shipment_status:'in_transit'}]})).toBe('delivery_not_verified');
    const delivered={fulfillment_status:'fulfilled',fulfillments:[{shipment_status:'delivered',tracking_number:'ABC'}]};
    expect(riverzOrderSkipReason('shipped',delivered)).toBe('already_delivered');
    expect(riverzOrderSkipReason('delivered',delivered)).toBeNull();
    expect(riverzOrderSkipReason('cancelled',{})).toBe('cancellation_not_verified');
  });
  it('does not treat a partial delivery as the whole purchase arriving',()=>expect(riverzOrderSkipReason('delivered',{fulfillment_status:'fulfilled',fulfillments:[{shipment_status:'delivered'},{shipment_status:'in_transit'}]})).toBe('delivery_not_verified'));
  it('does not touch other merchants',async()=>{const {db}=database([]);expect(await riverzFlowSkipReason(db,{...input(),workspaceId:'other'})).toBeNull();expect(db.from).not.toHaveBeenCalled();});
  it('rechecks a reply even if the wait was claimed before the reply arrived',async()=>{const {db}=database([{data:{created_at:'2026-09-14T00:00:00Z'}},{data:[{id:'conversation'}]},{count:1}]);const fetcher=vi.fn();expect(await riverzFlowSkipReason(db,{...input(),resumed:true},fetcher)).toBe('customer_already_replied');expect(fetcher).not.toHaveBeenCalled();});
  it('avoids interrupting a live conversation',async()=>{const {db}=database([{data:{created_at:'2026-09-14T00:00:00Z'}},{data:[{id:'conversation'}]},{count:0},{count:1}]);expect(await riverzFlowSkipReason(db,{...input(),resumed:true})).toBe('conversation_in_progress');});
  it('does not recover a checkout completed during a wait',async()=>{const {db,q}=database([{data:{completed_at:'now',line_items:[{title:'Bottle'}]}}]);expect(await riverzFlowSkipReason(db,{...input(),automationId:cart,vars:{checkout_url:'https://shop.test/cart'}})).toBe('checkout_completed');expect(q.eq).toHaveBeenCalledWith('workspace_id',RIVERZOFICIAL_WORKSPACE);});
  it('refreshes product and address data from the current order',async()=>{const {db}=database([]);const args=input();const fetcher=vi.fn(async()=>new Response(JSON.stringify({order:{id:123,financial_status:'pending',line_items:[{title:'Botella',variant_title:'Azul',quantity:2}],shipping_address:{address1:'Nueva dirección'},total_price:'40',currency:'COP'}})));expect(await riverzFlowSkipReason(db,args,fetcher)).toBeNull();expect(args.vars).toMatchObject({order_items:'2 × Botella (Azul)',delivery_address:'Nueva dirección'});});
  it('does not infer applicability when the order lookup fails',async()=>{const {db}=database([]);expect(await riverzFlowSkipReason(db,input(),vi.fn(async()=>new Response('',{status:503})))).toBe('order_state_unavailable');});
});
