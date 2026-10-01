import {createECDH,randomBytes} from 'node:crypto';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const h=vi.hoisted(()=>({visible:true,send:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.visible;}}));
vi.mock('./push-transport',()=>({sendBrowserPush:h.send}));
import {browserPushKeys,dispatchBrowserPush,manageBrowserPush,sealBrowserPush} from './push-server';
const ws='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const pair=createECDH('prime256v1');pair.generateKeys();const keys={publicKey:pair.getPublicKey().toString('base64url'),privateKey:Buffer.concat([Buffer.alloc(32),pair.getPrivateKey()]).subarray(-32).toString('base64url')};
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',expirationTime:null,keys:{p256dh:keys.publicKey,auth:randomBytes(16).toString('base64url')}};
const job=()=>({id,lease_id:id,subscription_id:id,workspace_id:ws,user_id:user,endpoint_hash:sealBrowserPush(ws,user,subscription).endpointHash,ciphertext:sealBrowserPush(ws,user,subscription).ciphertext,notice:{version:1,kind:'mention',conversation_id:id,locale:'es'}});
let rpc=vi.fn();const db=()=>({rpc} as unknown as SupabaseClient);
beforeEach(()=>{
 vi.clearAllMocks();h.visible=true;vi.stubEnv('BROWSER_PUSH_VAPID_PUBLIC_KEY',keys.publicKey);vi.stubEnv('BROWSER_PUSH_VAPID_PRIVATE_KEY',keys.privateKey);h.send.mockResolvedValue(201);
 rpc=vi.fn(async(name:string)=>({data:name==='claim_browser_push_notices'?[job()]:true,error:null}));
});
afterEach(()=>{vi.unstubAllEnvs();});
describe('Private browser notice dispatch',()=>{
 it('checks a matching VAPID pair rather than claiming malformed configuration is ready',()=>{
  expect(browserPushKeys()).toEqual(keys);vi.stubEnv('BROWSER_PUSH_VAPID_PRIVATE_KEY','a'.repeat(43));expect(browserPushKeys()).toBeNull();
 });
 it('does not read subscriptions or send outside comparison or without keys',async()=>{
  h.visible=false;expect(await dispatchBrowserPush(db())).toMatchObject({enabled:false,claimed:0});h.visible=true;vi.stubEnv('BROWSER_PUSH_VAPID_PRIVATE_KEY','');await dispatchBrowserPush(db());expect(rpc).not.toHaveBeenCalled();expect(h.send).not.toHaveBeenCalled();
 });
 it('seals the destination to the actual actor, workspace and hash before one write RPC',async()=>{
  rpc.mockResolvedValue({data:{enabled:true,expires_at:'2026-11-01T00:00:00Z'},error:null} as never);
  await manageBrowserPush(db(),ws,user,'save',subscription.endpoint,'en',subscription);
  const [name,args]=rpc.mock.calls[0];expect(name).toBe('manage_browser_push');expect(args).toMatchObject({p_workspace_id:ws,p_user_id:user,p_operation:'save',p_locale:'en'});
  expect(JSON.stringify(args)).not.toContain(subscription.endpoint);
 });
 it.each([[201,'acknowledged'],[410,'dropped'],[503,'uncertain']] as const)('records provider HTTP %i as %s without marking the bell read',async(code,state)=>{
  h.send.mockResolvedValue(code);const result=await dispatchBrowserPush(db());expect(result[state]).toBe(1);
  expect(rpc).toHaveBeenCalledWith('browser_push_receipt_current',{p_receipt_id:id});
  expect(h.send).toHaveBeenCalledExactlyOnceWith(subscription,job().notice,keys);expect(rpc).toHaveBeenLastCalledWith('finish_browser_push_notice',{p_id:id,p_lease_id:id,p_state:state,p_status_code:code});
 });
 it('does not replay an uncertain transport failure',async()=>{
  h.send.mockRejectedValue(new Error('PRIVATE_ENDPOINT_AND_PROVIDER_ERROR'));expect(await dispatchBrowserPush(db())).toMatchObject({uncertain:1});
  expect(rpc).toHaveBeenLastCalledWith('finish_browser_push_notice',{p_id:id,p_lease_id:id,p_state:'uncertain',p_status_code:null});
 });
 it.each(['changed_actor','changed_workspace','copied_cipher','revoked_access'])('drops %s before an external send',async kind=>{
  const data=job();if(kind==='changed_actor')data.user_id=id;if(kind==='changed_workspace')data.workspace_id=id;if(kind==='copied_cipher')data.ciphertext='bad';
  rpc.mockImplementation(async name=>({data:name==='claim_browser_push_notices'?[data]:name==='browser_push_receipt_current'?kind!=='revoked_access':true,error:null}));
  expect(await dispatchBrowserPush(db())).toMatchObject({dropped:1});expect(h.send).not.toHaveBeenCalled();
 });
 it('does not report completion if the durable acknowledgment fails',async()=>{
  rpc.mockImplementation(async name=>({data:name==='claim_browser_push_notices'?[job()]:name!=='finish_browser_push_notice',error:null}));
  await expect(dispatchBrowserPush(db())).rejects.toThrow('browser_push_receipt_unconfirmed');expect(h.send).toHaveBeenCalledOnce();
 });
});
