import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Contact,Conversation,VoiceCall} from '@/types';
import {resolveVoiceContextConversation} from './context';
import {loadContext} from '@/lib/ai/runner';
const ws='11111111-1111-4111-8111-111111111111',contactId='22222222-2222-4222-8222-222222222222',conversationId='33333333-3333-4333-8333-333333333333';
const contact={id:contactId,workspace_id:ws} as Contact;
const call={workspace_id:ws,context:{__whatsapp_call:{},__riverz:{origin:'manual'}}} as unknown as VoiceCall;
function fixture(row:Partial<Conversation>|null,error:unknown=null){
 const not=vi.fn(),rpc=vi.fn().mockResolvedValue({data:[contactId],error:null});
 const query={select:()=>query,eq:()=>query,in:()=>query,is:()=>query,not:(...args:unknown[])=>{not(...args);return query;},order:()=>query,limit:()=>query,maybeSingle:async()=>({data:row,error})};
 return {not,rpc,db:{rpc,from:()=>query} as unknown as SupabaseClient};
}
describe('WhatsApp voice context anchor privacy',()=>{
 it('uses the verified identity family and excludes private email at the database boundary',async()=>{
  const row={id:conversationId,workspace_id:ws,contact_id:contactId,channel:'whatsapp'} as Conversation;
  const {db,not,rpc}=fixture(row);expect(await resolveVoiceContextConversation(db,call,contact,contact)).toEqual(row);
  expect(rpc).toHaveBeenCalledWith('verified_contact_family',{p_workspace_id:ws,p_contact_id:contactId});expect(not).toHaveBeenCalledWith('channel','in','(gmail,outlook,zoho)');
 });
 it.each(['gmail','outlook','zoho',undefined] as const)('fails closed if a private/unknown %s anchor is returned',async channel=>{
  const {db}=fixture({id:conversationId,workspace_id:ws,contact_id:contactId,channel});expect(await resolveVoiceContextConversation(db,call,contact,contact)).toBeNull();
 });
 it('does not accept an unverified contact or workspace, even if the query returns it',async()=>{
  for(const row of [{id:conversationId,workspace_id:contactId,contact_id:contactId,channel:'whatsapp'},{id:conversationId,workspace_id:ws,contact_id:conversationId,channel:'whatsapp'}]){
   const {db}=fixture(row as Conversation);expect(await resolveVoiceContextConversation(db,call,contact,contact)).toBeNull();
  }
 });
 it('does not fall back to raw identity pointers on a query error',async()=>{
  const {db}=fixture(null,{message:'private database error'});expect(await resolveVoiceContextConversation(db,call,contact,contact)).toBeNull();
 });
});

describe('WhatsApp call model history boundary',()=>{
 it('drops legacy summaries with unknown mailbox provenance and queries only safe message IDs',async()=>{
  const messageIds=vi.fn(),reads:string[]=[];
  const db={rpc:async()=>({data:[contactId],error:null}),from:(table:string)=>{
   reads.push(table);const data:unknown[]=table==='conversations'?[{id:conversationId,workspace_id:ws,contact_id:contactId,channel:'whatsapp'}]:table==='messages'?[{id:'fixture-message',sender_type:'customer',content_text:'Public customer message',created_at:new Date().toISOString(),channel:'whatsapp',conversation_id:conversationId}]:[];
   const query={select:()=>query,eq:()=>query,in:(field:string,ids:string[])=>{if(table==='messages')messageIds(field,ids);return query;},is:()=>query,not:()=>query,order:()=>query,limit:async()=>({data,error:null})};return query;
  }} as unknown as SupabaseClient;
  const result=await loadContext(db,{id:conversationId,workspace_id:ws,contact_id:contactId,channel:'whatsapp',ai_summary:'PRIVATE LEGACY SUMMARY'} as Conversation,30,{excludePersonalEmail:true});
  expect(result.rollingSummary).toBeNull();expect(result.messages.map(message=>message.content).join('\n')).toContain('Public customer message');expect(JSON.stringify(result)).not.toContain('PRIVATE LEGACY SUMMARY');
  expect(messageIds).toHaveBeenCalledWith('conversation_id',[conversationId]);expect(reads.filter(table=>table==='conversations')).toHaveLength(1);
 });
 it('returns an empty context for a personal mailbox without reading its messages or summary',async()=>{
  const from=vi.fn(),rpc=vi.fn();const db={from,rpc} as unknown as SupabaseClient;
  expect(await loadContext(db,{id:conversationId,workspace_id:ws,contact_id:contactId,channel:'gmail',ai_summary:'PRIVATE'} as Conversation,30,{excludePersonalEmail:true})).toEqual({messages:[],rollingSummary:null,idleResetHint:null});
  expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
});
