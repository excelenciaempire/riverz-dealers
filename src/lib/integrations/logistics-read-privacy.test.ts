import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('@/lib/shopify/order-tags',()=>({resolveShopifyAdmin:vi.fn(async()=>({shopDomain:'shop.myshopify.com',apiVersion:'2026-07',accessToken:'SYNTHETIC'}))}));
vi.mock('@/lib/logistics/access',()=>({logisticsAccess:vi.fn(),visibleLogisticsConversations:vi.fn(),visibleLogisticsCalls:vi.fn()}));
import {logisticsAccess,visibleLogisticsConversations,visibleLogisticsCalls} from '@/lib/logistics/access';
import {readLogisticsReview} from './logistics-read';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',contact='33333333-3333-4333-8333-333333333333',conv='44444444-4444-4444-8444-444444444444',call='55555555-5555-4555-8555-555555555555';
const order={id:42,name:'#42',created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',cancelled_at:null,total_price:'1000',currency:'COP',fulfillment_status:null,shipping_address:{address1:'SYNTHETIC',phone:'573000000000'},line_items:[]};
function fixture(){
 const reads:Array<{table:string;columns:string}>=[];const db={from:(table:string)=>{let columns='';const rows=()=>table==='contacts'?[{id:contact}]:table==='conversations'?[{id:conv}]:table==='voice_calls'?[{id:call,status:'completed',summary:'PRIVATE_CALL',ended_at:null,cod_writeback:false}]:table==='messages'?[{id:call,conversation_id:conv,content_text:'PRIVATE_MESSAGE',sender_type:'contact',status:'delivered',created_at:'2026-09-01T00:00:00Z'}]:[];
  const query={select:(value:string)=>{columns=value;reads.push({table,columns});return query;},eq:()=>query,in:()=>query,contains:()=>query,gte:()=>query,order:()=>query,limit:()=>query,maybeSingle:async()=>({data:null,error:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows(),error:null}).then(resolve)};return query;
 }} as unknown as SupabaseClient;
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({orders:[order]})));return {db,reads,fetcher};
}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(logisticsAccess).mockResolvedValue({inbox:true,voice:true});vi.mocked(visibleLogisticsConversations).mockResolvedValue(new Set([conv]));vi.mocked(visibleLogisticsCalls).mockResolvedValue(new Set([call]));});
describe('Logistics body reads use current metadata allowlists',()=>{
 it('does not read integrations or Shopify before current actor authorization',async()=>{
  const {db,reads,fetcher}=fixture();vi.mocked(logisticsAccess).mockRejectedValueOnce(new Error('forbidden'));await expect(readLogisticsReview(db,ws,actor,'es',undefined,fetcher)).rejects.toThrow('forbidden');expect(reads).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
 });
 it('never loads summaries or message bodies when case metadata denies access',async()=>{
  const {db,reads,fetcher}=fixture();vi.mocked(visibleLogisticsConversations).mockResolvedValue(new Set());vi.mocked(visibleLogisticsCalls).mockResolvedValue(new Set());const report=await readLogisticsReview(db,ws,actor,'es',undefined,fetcher);
  expect(report.orders[0]).toMatchObject({calls:[],messages:[]});expect(reads.some(row=>row.table==='messages'||row.columns.includes('summary'))).toBe(false);expect(report.executable).toBe(false);
 });
 it('preserves permitted histories and labels them as contact context, not confirmation',async()=>{
  const {db,fetcher}=fixture();const report=await readLogisticsReview(db,ws,actor,'en',undefined,fetcher);expect(report.orders[0]).toMatchObject({contextNote:'contact_history_not_order_confirmation',calls:[{summary:'PRIVATE_CALL'}],messages:[{text:'PRIVATE_MESSAGE'}]});expect(visibleLogisticsConversations).toHaveBeenCalledWith(db,ws,actor,[conv],contact);expect(visibleLogisticsCalls).toHaveBeenLastCalledWith(db,ws,actor,'42',[call]);
 });
 it('drops already loaded bodies if case access is revoked while they load',async()=>{
  const {db,fetcher}=fixture();vi.mocked(visibleLogisticsConversations).mockResolvedValueOnce(new Set([conv])).mockResolvedValueOnce(new Set());vi.mocked(visibleLogisticsCalls).mockResolvedValueOnce(new Set([call])).mockResolvedValueOnce(new Set());const report=await readLogisticsReview(db,ws,actor,'es',undefined,fetcher);expect(report.orders[0]).toMatchObject({calls:[],messages:[]});expect(JSON.stringify(report)).not.toMatch(/PRIVATE_MESSAGE|PRIVATE_CALL/);
 });
 it('does not load case or voice context with Orders-only permission',async()=>{
  const {db,reads,fetcher}=fixture();vi.mocked(logisticsAccess).mockResolvedValue({inbox:false,voice:false});const report=await readLogisticsReview(db,ws,actor,'es',undefined,fetcher);expect(report.orders[0]).toMatchObject({calls:[],messages:[]});expect(reads.some(row=>['voice_calls','conversations','messages'].includes(row.table))).toBe(false);
 });
 it('fails the whole response on a removed membership instead of returning partial private data',async()=>{
  const {db,fetcher}=fixture();vi.mocked(logisticsAccess).mockResolvedValueOnce({inbox:true,voice:true}).mockRejectedValueOnce(new Error('forbidden'));await expect(readLogisticsReview(db,ws,actor,'es',undefined,fetcher)).rejects.toThrow('forbidden');
 });
});
