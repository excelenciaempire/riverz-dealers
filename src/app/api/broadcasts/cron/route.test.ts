import {beforeEach,describe,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({send:vi.fn(),voice:vi.fn(),rpc:vi.fn(),config:vi.fn(),auth:vi.fn(),campaign:{} as Record<string,unknown>,recipient:{} as Record<string,unknown>,claimState:null as string|null,writes:[] as {table:string;value:Record<string,unknown>}[]}))
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>db}))
vi.mock('@/lib/whatsapp/meta-api',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/whatsapp/meta-api')>(),sendTemplateMessage:m.send}))
vi.mock('@/lib/voice-notes/service',()=>({sendVoiceNote:m.voice}))
vi.mock('@/lib/whatsapp/config-del-comercio',()=>({leerConfigWhatsApp:m.config}))
vi.mock('@/lib/whatsapp/encryption',()=>({decrypt:()=> 'test-token'}))
vi.mock('@/lib/whatsapp/throttle',()=>({acquire:async()=>{}}))
vi.mock('@/lib/whatsapp/tier-cap',()=>({resolveWhatsAppConnectionId:async()=>null,assertWithinTierCap:async()=>({allowed:true})}))
vi.mock('@/lib/workspaces/motor',()=>({motorApagado:async()=>false}))
vi.mock('@/lib/auth/cron',()=>({assertCronAuthAny:m.auth}))
vi.mock('@/lib/cron/heartbeat',()=>({withCronRun:(_name:string,handler:unknown)=>handler}))
vi.mock('@/lib/log/logger',()=>({getLogger:()=>({captureException:vi.fn()})}))
vi.mock('@/lib/broadcasts/conversations',()=>({recordBroadcastConversation:vi.fn()}))
import { GET } from './route'
const db={rpc:m.rpc,from(table:string){
 const filters:Record<string,unknown>={};let update:Record<string,unknown>|null=null;let cutoff:string|undefined
 const execute=()=>{
  const matches=(row:Record<string,unknown>)=>Object.entries(filters).every(([key,value])=>row[key]===value)
  if(update){
   const row=table==='broadcasts'?m.campaign:table==='broadcast_recipients'?m.recipient:null
   if(row&&matches(row)&&(!cutoff||String(row.updated_at)<cutoff)){Object.assign(row,update);m.writes.push({table,value:update});return{data:{id:row.id},error:null}}
   return{data:null,error:null}
  }
  if(table==='broadcasts')return{data:matches(m.campaign)?[structuredClone(m.campaign)]:[],error:null}
  if(table==='broadcast_recipients')return{data:matches(m.recipient)?[structuredClone(m.recipient)]:[],error:null}
  if(table==='message_templates')return{data:[{id:'template',category:'UTILITY',status:'APPROVED',body_text:'Hola {{1}}.'}],error:null}
  if(table==='conversations')return{data:{id:'conversation'},error:null}
  return{data:{config:{}},error:null}
 }
 const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q},is:()=>q,order:()=>q,limit:()=>q,range:()=>q,lte:()=>q,lt:(_key:string,value:string)=>{cutoff=value;return q},update:(value:Record<string,unknown>)=>{update=value;return q},maybeSingle:async()=>{const result=execute();return{...result,data:Array.isArray(result.data)?result.data[0]??null:result.data}},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(execute()).then(resolve)}
 return q
}}
beforeEach(()=>{
 vi.clearAllMocks();m.writes=[];m.claimState=null
 m.campaign={id:'campaign',workspace_id:'workspace',user_id:'owner',status:'scheduled',updated_at:new Date().toISOString(),template_name:'hello',template_language:'es',voice_note:null,variable_mapping:null,audience_filter:null,create_conversations:false}
 m.recipient={id:'recipient',broadcast_id:'campaign',contact_id:'contact',status:'pending',params:['Ana'],contact:{id:'contact',workspace_id:'workspace',phone:'573003364305'}}
 m.config.mockResolvedValue({access_token:'encrypted',phone_number_id:'business-phone'});m.auth.mockReturnValue(undefined);m.send.mockResolvedValue({messageId:'wamid.confirmed'});m.voice.mockResolvedValue({externalMessageId:'wamid.audio'})
 m.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='finalize_broadcast_delivery_progress'){const status=m.recipient.status==='pending'?'scheduled':m.recipient.status==='failed'?'failed':'sent';m.campaign.status=status;return{data:{status},error:null}}
  if(name==='claim_broadcast_delivery')return{data:m.claimState?{claimed:false,state:m.claimState,message_id:m.claimState==='accepted'?'wamid.prior':undefined,receipt_id:'prior'}:{claimed:true,state:'sending',receipt_id:args.p_id},error:null}
  if(args.p_state==='accepted'){m.recipient.status='sent';m.recipient.whatsapp_message_id=args.p_message_id}else{m.recipient.status='failed'}
  return{data:{ok:true},error:null}
 })
})
const run=()=>GET(new Request('http://localhost/api/broadcasts/cron'))
describe('campaign cron uses the shared durable reservation',()=>{
 it('sends a pending campaign through a reservation and stores confirmed proof on the server',async()=>{
  expect((await run()).status).toBe(200);expect(m.send).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[0][0]).toBe('claim_broadcast_delivery');expect(m.rpc.mock.calls[1][1]).toMatchObject({p_state:'accepted',p_message_id:'wamid.confirmed'});expect(m.campaign.status).toBe('sent');expect(m.config).toHaveBeenCalledWith(db,{workspaceId:'workspace',userId:'owner'})
 })
 it('does not resend an interrupted live or uncertain attempt, including voice notes',async()=>{
  m.claimState='sending';await run();expect(m.send).not.toHaveBeenCalled();expect(m.campaign.status).toBe('scheduled');m.claimState='uncertain';m.campaign.status='scheduled';m.campaign.voice_note={text:'audio'};await run();expect(m.voice).not.toHaveBeenCalled();expect(m.campaign.status).toBe('failed')
 })
 it('repairs previously accepted proof without transport and preserves a completed campaign with no pending recipients',async()=>{
  m.claimState='accepted';await run();expect(m.send).not.toHaveBeenCalled();expect(m.recipient.status).toBe('sent');m.campaign.status='scheduled';m.rpc.mockClear();await run();expect(m.campaign.status).toBe('sent');expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[0][0]).toBe('finalize_broadcast_delivery_progress');expect(m.send).not.toHaveBeenCalled()
 })
 it('uses the same reservation and exact recipient guard for campaign audio',async()=>{
  m.campaign.voice_note={text:'audio'};await run();expect(m.voice).toHaveBeenCalledWith(expect.objectContaining({expectedRecipient:{contactId:'contact',phone:'573003364305'}}));expect(m.rpc.mock.calls[1][1]).toMatchObject({p_state:'accepted',p_message_id:'wamid.audio'})
 })
 it('refuses an unauthenticated cron before any campaign or provider action',async()=>{
  m.auth.mockImplementation(()=>{throw new Response(null,{status:401})});expect((await run()).status).toBe(401);expect(m.send).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();expect(m.config).not.toHaveBeenCalled()
 })
})
