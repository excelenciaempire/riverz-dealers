import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({rpc:vi.fn(),send:vi.fn(),session:vi.fn(),csrf:vi.fn(),config:vi.fn(),gate:vi.fn(),events:[] as string[],filters:[] as unknown[][],admin:true,locale:'es',templateStatus:'APPROVED',claimState:null as Record<string,unknown>|null,tableError:null as unknown,rows:[] as Record<string,unknown>[]}))
vi.mock('@/lib/inbox/server-context',()=>({inboxSession:m.session}))
vi.mock('@/lib/csrf',()=>({csrfGuard:m.csrf}))
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>m.locale}))
vi.mock('@/lib/whatsapp/config-del-comercio',()=>({leerConfigWhatsApp:m.config}))
vi.mock('@/lib/whatsapp/encryption',()=>({decrypt:()=> 'test-token'}))
vi.mock('@/lib/whatsapp/meta-api',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/whatsapp/meta-api')>(),sendTemplateMessage:m.send}))
vi.mock('@/lib/whatsapp/throttle',()=>({acquire:async()=>{}}))
vi.mock('@/lib/whatsapp/tier-cap',()=>({resolveWhatsAppConnectionId:async()=> 'connection',assertWithinTierCap:m.gate}))
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:()=>({success:true}),rateLimitResponse:vi.fn()}))
vi.mock('@/lib/broadcasts/conversations',()=>({recordBroadcastConversation:vi.fn()}))
import { POST } from './route'
const ws='11111111-1111-4111-8111-111111111111',bid='22222222-2222-4222-8222-222222222222',rid='33333333-3333-4333-8333-333333333333',cid='44444444-4444-4444-8444-444444444444'
const campaign={id:bid,workspace_id:ws,user_id:'owner',status:'sending',template_name:'hello',template_language:'es',voice_note:null,variable_mapping:null,audience_filter:null,create_conversations:false}
const db={rpc:m.rpc,from(table:string){
 const q={select:()=>q,eq:(...args:unknown[])=>{m.filters.push([table,...args]);return q},in:()=>q,limit:()=>q,update:()=>q,
  maybeSingle:async()=>({data:campaign,error:m.tableError}),
  then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='message_templates'?[{id:'template',category:'UTILITY',status:m.templateStatus,body_text:'Hola {{1}}.'}]:m.rows,error:m.tableError}).then(resolve)}
 return q
}}
const ctx=()=>({db,workspaceId:ws,userId:'owner',isAdmin:m.admin})
const request=(extra:Record<string,unknown>={})=>new Request('http://localhost/api/broadcasts/send-batch',{method:'POST',body:JSON.stringify({broadcast_id:bid,recipient_ids:[rid],...extra})})
beforeEach(()=>{
 vi.clearAllMocks();m.events=[];m.filters=[];m.admin=true;m.locale='es';m.templateStatus='APPROVED';m.claimState=null;m.tableError=null
 m.rows=[{id:rid,broadcast_id:bid,contact_id:cid,status:'pending',params:['Ana'],contact:{id:cid,workspace_id:ws,phone:'573003364305'}}]
 m.session.mockImplementation(async()=>ctx());m.csrf.mockResolvedValue(null);m.config.mockResolvedValue({access_token:'encrypted',phone_number_id:'phone-id'});m.gate.mockResolvedValue({allowed:true})
 m.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  m.events.push(name)
  if(name==='finalize_broadcast_delivery_progress')return{data:{status:m.rows.some(row=>row.status==='pending')?'scheduled':'sent'},error:null}
  if(name==='finish_broadcast_delivery'&&args.p_state==='accepted')m.rows[0].status='sent'
  return{data:name==='claim_broadcast_delivery'?(m.claimState??{claimed:true,state:'sending',receipt_id:args.p_id}):{ok:true},error:null}
 })
 m.send.mockImplementation(async()=>{m.events.push('provider');return{messageId:'wamid.confirmed'}})
})
describe('authorized persisted campaign batches',()=>{
 it('requests finalization from the database only after verified membership and stored proof',async()=>{
  expect((await POST(request({finalize:true}))).status).toBe(200);expect(m.rpc.mock.calls.at(-1)).toEqual(['finalize_broadcast_delivery_progress',{p_workspace_id:ws,p_broadcast_id:bid,p_actor_id:'owner',p_defer_seconds:60}]);expect(m.events).toEqual(['claim_broadcast_delivery','provider','finish_broadcast_delivery','finalize_broadcast_delivery_progress'])
 })
 it('reads the actual campaign and stored recipient data in the active workspace before reserving and sending',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({results:[{recipient_id:rid,status:'sent',whatsapp_message_id:'wamid.confirmed'}]});expect(response.headers.get('cache-control')).toContain('no-store')
  expect(m.filters).toContainEqual(['broadcasts','workspace_id',ws]);expect(m.filters).toContainEqual(['broadcast_recipients','broadcast_id',bid]);expect(m.config).toHaveBeenCalledWith(db,{workspaceId:ws});expect(m.events).toEqual(['claim_broadcast_delivery','provider','finish_broadcast_delivery']);expect(m.send).toHaveBeenCalledWith(expect.objectContaining({to:'573003364305',params:['Ana'],templateName:'hello',language:'es',signal:expect.any(AbortSignal)}))
 })
 it('does not accept customer-supplied phones, text, repeated ids or an oversized batch',async()=>{
  for(const extra of [{phone:'other'},{template_name:'different'},{recipient_ids:[rid,rid]},{recipient_ids:Array(11).fill(rid)},{recipient_ids:[]}])expect((await POST(request(extra))).status).toBe(400)
  expect(m.send).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled()
 })
 it('requires session and CSRF before touching provider credentials',async()=>{
  m.csrf.mockResolvedValue(new Response(null,{status:403}));expect((await POST(request())).status).toBe(403);expect(m.session).not.toHaveBeenCalled();m.csrf.mockResolvedValue(null);m.session.mockResolvedValue({response:new Response(null,{status:401})});expect((await POST(request())).status).toBe(401);expect(m.config).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled()
 })
 it('rejects another business’s contacts or another owner’s campaign for a non-administrator',async()=>{
  m.rows[0].contact={id:cid,workspace_id:'other',phone:'573003364305'};expect((await POST(request())).status).toBe(404);m.rows[0].contact={id:cid,workspace_id:ws,phone:'573003364305'};m.admin=false;m.session.mockImplementation(async()=>({...ctx(),userId:'another-member'}));expect((await POST(request())).status).toBe(404);expect(m.send).not.toHaveBeenCalled();expect(m.config).not.toHaveBeenCalled()
 })
 it('leaves quota-limited recipients deferred without reserving or sending',async()=>{
  m.gate.mockResolvedValue({allowed:false});expect(await(await POST(request())).json()).toMatchObject({results:[{recipient_id:rid,status:'deferred'}]});expect(m.rpc).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled()
 })
 it('does not resend uncertain, live or already confirmed attempts',async()=>{
  for(const state of ['uncertain','sending','accepted']){
   m.claimState={claimed:false,state,message_id:'wamid.prior',receipt_id:'prior'};const data=await(await POST(request())).json();expect(data.results[0].status).toBe(state==='accepted'?'sent':state==='sending'?'deferred':'failed')
  }
  expect(m.send).not.toHaveBeenCalled()
 })
 it('checks the current approved template and localizes unknown outcomes in English',async()=>{
  m.templateStatus='PAUSED';expect((await(await POST(request())).json()).results[0].status).toBe('failed');expect(m.send).not.toHaveBeenCalled();m.templateStatus='APPROVED';m.locale='en';m.send.mockRejectedValue(new Error('secret provider details'));const data=await(await POST(request())).json();expect(data.results[0]).toMatchObject({status:'failed',error:'Uncertain outcome. Review the provider before sending again.'});expect(JSON.stringify(data)).not.toContain('secret')
 })
 it('withholds results when workspace membership is revoked after the attempt',async()=>{
  m.session.mockResolvedValueOnce(ctx()).mockResolvedValueOnce({response:new Response(null,{status:403})});expect((await POST(request())).status).toBe(403);expect(m.send).toHaveBeenCalledTimes(1)
 })
})
