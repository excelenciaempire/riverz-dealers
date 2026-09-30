import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { translate } from '@/lib/i18n/translate'
import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { broadcastDeliveryError } from './delivery-errors'
import { definiteDeliveryRejection, deliveryHash, dispatchBroadcastRecipient, loadBroadcastTemplate } from './delivery'
const template={ id:'template',category:'UTILITY',status:'APPROVED',body_text:'Hola {{1}}.' }
const broadcast={ id:'campaign',workspace_id:'workspace',user_id:'creator',template_name:'hello',template_language:'es',voice_note:null,variable_mapping:null,audience_filter:{excludeTagIds:[]} }
const recipient={ id:'recipient',broadcast_id:'campaign',contact_id:'contact',params:['Ana'],contact:{id:'contact',workspace_id:'workspace',phone:'573003364305',name:'Ana'} }
const filters:unknown[][]=[]
let sharedTemplates:unknown[] | null,templates:unknown[],templateError:unknown,claimState:Record<string,unknown>|null,claimError:unknown,finishError:unknown
const events:string[]=[],rpc=vi.fn(),send=vi.fn()
const db={
 from:vi.fn((table:string)=>{
  let personal=false
  const q={order:()=>q,select:()=>q,eq:(...args:unknown[])=>{if(args[0]==='user_id')personal=true;filters.push(args);return q},limit:(value:number)=>{filters.push(['limit',value]);return q},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='whatsapp_config'?[{waba_id:'waba'}]:personal?templates:(sharedTemplates??templates),error:templateError}).then(resolve)}
  return q
 }),rpc,
} as unknown as SupabaseClient
beforeEach(()=>{
 vi.clearAllMocks();filters.length=0;events.length=0;sharedTemplates=null;templates=[template];templateError=null;claimState=null;claimError=null;finishError=null
 rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  events.push(name)
  return name==='claim_broadcast_delivery'?{data:claimState??{claimed:true,state:'sending',receipt_id:args.p_id},error:claimError}:{data:finishError?null:{ok:true},error:finishError}
 })
 send.mockImplementation(async()=>{events.push('provider');return{messageId:'wamid.confirmed'}})
})
const dispatch=()=>dispatchBroadcastRecipient(db,{broadcast,recipient,actorId:'owner',send})
describe('shared durable campaign dispatcher',()=>{
 it('records and previews the normalized parameters actually passed to the provider',async()=>{
  const result=await dispatchBroadcastRecipient(db,{broadcast,recipient:{...recipient,params:['Ana\nPérez']},send});expect(send).toHaveBeenCalledWith(expect.objectContaining({params:['Ana · Pérez']}));expect(result.payload?.params).toEqual(['Ana · Pérez'])
 })
 it('reserves before the provider and records a concrete message id after it',async()=>{
  expect(await dispatch()).toMatchObject({status:'sent',attempted:true,recorded:true,messageId:'wamid.confirmed'})
  expect(events).toEqual(['claim_broadcast_delivery','provider','finish_broadcast_delivery'])
  expect(rpc.mock.calls[0][1]).toMatchObject({p_workspace_id:'workspace',p_broadcast_id:'campaign',p_recipient_id:'recipient',p_actor_id:'owner'})
  expect(send).toHaveBeenCalledWith(expect.objectContaining({phone:'573003364305',params:['Ana']}))
  expect(filters).toEqual([['workspace_id','workspace'],['user_id','creator'],['name','hello'],['language','es'],['limit',2]])
 })
 it('reuses accepted proof without sending and repairs only the same idempotent receipt',async()=>{
  claimState={claimed:false,state:'accepted',message_id:'wamid.confirmed',receipt_id:'prior'}
  expect(await dispatch()).toMatchObject({status:'sent',replayed:true,attempted:false});expect(send).not.toHaveBeenCalled();expect(rpc.mock.calls[1][1]).toMatchObject({p_id:'prior',p_state:'accepted',p_message_id:'wamid.confirmed'})
 })
 it.each(['sending','uncertain','rejected','duplicate','changed','paused','not_pending','already_sent','excluded','opted_out'])('never calls the provider for an existing/blocked %s reservation',async(state)=>{
  claimState={claimed:false,state};const result=await dispatch();expect(result.attempted).toBe(false);expect(result.status).not.toBe('sent');expect(send).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1)
 })
 it('does not send or fall back when the receipt database is unavailable or malformed',async()=>{
  claimError={message:'private_database_detail'};await expect(dispatch()).rejects.toThrow('broadcast_delivery_unavailable');expect(send).not.toHaveBeenCalled();claimError=null;claimState={state:'sending'};await expect(dispatch()).rejects.toThrow('broadcast_delivery_unavailable');expect(send).not.toHaveBeenCalled()
 })
 it('treats network failure and missing provider proof as uncertain, without repeating transport',async()=>{
  for(const outcome of [new Error('network timeout'),new MetaApiError('upstream',503),{messageId:''},{}]){
   send.mockReset();if(outcome instanceof Error)send.mockRejectedValue(outcome);else send.mockResolvedValue(outcome)
   const result=await dispatch();expect(result).toMatchObject({status:'failed',code:'uncertain',attempted:true});expect(send).toHaveBeenCalledTimes(1);expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_state:'uncertain',p_message_id:null})
  }
 })
 it('records an explicit rejection without leaking provider details or automatically retrying',async()=>{
  send.mockRejectedValue(new MetaApiError('private provider details',400,131030));const result=await dispatch();expect(result.code).toBe('rejected');expect(JSON.stringify(result)).not.toContain('private');expect(send).toHaveBeenCalledTimes(1)
  expect(definiteDeliveryRejection(new MetaApiError('timeout',408))).toBe(false);expect(definiteDeliveryRejection(new MetaApiError('conflict',409))).toBe(false)
 })
 it('retries only the exact outcome write, keeping the reservation if both writes fail',async()=>{
  finishError={message:'database unavailable'};const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
  try{const result=await dispatch();expect(result).toMatchObject({status:'sent',recorded:false});expect(send).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[2][1]);claimState={claimed:false,state:'sending'};expect((await dispatch()).status).toBe('deferred');expect(send).toHaveBeenCalledTimes(1)}finally{warn.mockRestore()}
 })
 it('requires an approved unambiguous template in this business and language',async()=>{
  for(const rows of [[],[template,template],[{...template,status:'PAUSED'}],[{...template,category:'unknown'}]]){templates=rows;expect((await dispatch()).code).toBe('templateUnavailable')}
  expect(send).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();templateError={message:'database'};await expect(loadBroadcastTemplate(db,'workspace','hello','es','creator')).rejects.toThrow('broadcast_delivery_unavailable')
 })
 it('allows a teammate to use equivalent copies from the connected account, but rejects conflicts',async()=>{
  templates=[];sharedTemplates=[template,{...template,id:'another'}]
  expect((await dispatch()).status).toBe('sent');expect(filters).toContainEqual(['waba_id','waba'])
  sharedTemplates=[template,{...template,id:'another',body_text:'different'}];expect((await dispatch()).code).toBe('templateUnavailable')
  sharedTemplates=[template,{...template,id:'another',status:'PAUSED'}];expect((await dispatch()).code).toBe('templateUnavailable')
 })
 it('checks recipient scope and complete variable positions before claiming',async()=>{
  expect((await dispatchBroadcastRecipient(db,{broadcast,recipient:{...recipient,contact:{...recipient.contact,workspace_id:'other'}},send})).code).toBe('invalid')
  expect((await dispatchBroadcastRecipient(db,{broadcast,recipient:{...recipient,params:[]},send})).code).toBe('variables');templates=[{...template,body_text:'Hola {{2}}.'}];expect((await dispatch()).code).toBe('variables');expect(rpc).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
 })
 it('protects voice-note sends through the same reservation without loading a template',async()=>{
  expect((await dispatchBroadcastRecipient(db,{broadcast:{...broadcast,voice_note:{text:'audio'}},recipient,send})).status).toBe('sent');expect(db.from).not.toHaveBeenCalled();expect(send).toHaveBeenCalledWith(expect.objectContaining({params:[],template:null}))
 })
 it('hashes canonical payloads consistently and renders stable failure codes in both locales',()=>{
  expect(deliveryHash({b:2,a:1})).toBe(deliveryHash({a:1,b:2}));expect(deliveryHash({a:2})).not.toBe(deliveryHash({a:1}))
  for(const locale of ['es','en'] as const){const t=(key:string)=>translate(locale,key);expect(broadcastDeliveryError('broadcast_delivery_uncertain',t)).toBe(t('broadcasts.deliveryUncertain'));expect(broadcastDeliveryError('broadcast_delivery_rejected',t)).toBe(t('broadcasts.deliveryRejected'))}
  expect(broadcastDeliveryError('legacy error',()=> 'translated')).toBe('legacy error')
 })
})
