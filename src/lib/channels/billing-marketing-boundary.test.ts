import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('./encryption',()=>({decrypt:()=> 'test-token'}));
import {requestOptIn,sendToSubscriber,type MarketingOptin} from './marketing-optin';
function database(allowed:boolean|null) {
 const chain:object=new Proxy({}, {get:(_target,key)=>key==='then'?(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[],count:0}).then(resolve):()=>chain});
 return {from:()=>chain,rpc:vi.fn().mockResolvedValue(allowed===null?{error:{message:'unavailable'}}:{data:allowed})} as unknown as SupabaseClient;
}
const optin={id:'optin',workspace_id:'workspace',status:'active',notification_messages_token:'permission',next_eligible_at:null,token_expiry_timestamp:null} as MarketingOptin;
const input={senderId:'sender',accessTokenEncrypted:'encrypted',text:'Hola'};
afterEach(()=>vi.unstubAllGlobals());
describe('monthly billing also gates Meta marketing sends',()=>{
 it('blocks opted-in marketing messages after grace even with a valid permission token',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect((await sendToSubscriber(database(false),optin,input)).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('blocks permission requests while read-only',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect(await requestOptIn(database(false),{...input,workspaceId:'workspace',connectionId:'connection',channel:'instagram',externalContactId:'person'})).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('fails closed if payment cannot be verified',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect((await sendToSubscriber(database(null),optin,input)).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('allows a normal marketing send after verified payment',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({message_id:'meta-message'}),{status:200}));vi.stubGlobal('fetch',fetch);
  expect((await sendToSubscriber(database(true),optin,input)).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
});
