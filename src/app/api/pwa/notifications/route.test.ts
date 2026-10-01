import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createECDH,randomBytes} from 'node:crypto';
const ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const h=vi.hoisted(()=>({visible:true,user:'session-actor',workspace:'11111111-1111-4111-8111-111111111111',access:{admin:false,sections:null as string[]|null} as {admin:boolean;sections:string[]|null}|null,csrf:vi.fn(),rate:vi.fn(),manage:vi.fn(),keys:vi.fn(),client:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.visible;}}));
vi.mock('@/lib/supabase/server',()=>({createClient:h.client}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:async()=>h.workspace}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({private:true})}));
vi.mock('@/lib/mcp/access',()=>({userAccess:async()=>h.access}));
vi.mock('@/lib/csrf',()=>({csrfGuard:h.csrf}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:h.rate}));
vi.mock('@/lib/pwa/push-server',()=>({browserPushKeys:h.keys,manageBrowserPush:h.manage}));
import {GET,POST,DELETE} from './route';
const pair=createECDH('prime256v1');pair.generateKeys();const publicKey=pair.getPublicKey().toString('base64url');
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',expirationTime:null,keys:{p256dh:publicKey,auth:randomBytes(16).toString('base64url')}};
const request=(method='GET',body?:unknown,workspace=ws)=>new Request('https://riverz.test/api/pwa/notifications',{method,headers:{'content-type':'application/json','x-riverz-workspace':workspace},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
beforeEach(()=>{
 vi.clearAllMocks();h.visible=true;h.user='session-actor';h.workspace=ws;h.access={admin:false,sections:null};h.csrf.mockResolvedValue(null);h.rate.mockResolvedValue({success:true});h.keys.mockReturnValue({publicKey,privateKey:'NEVER_RETURN_PRIVATE_KEY'});h.manage.mockResolvedValue({enabled:true});h.client.mockResolvedValue({auth:{getUser:async()=>({data:{user:h.user?{id:h.user}:null},error:null})}});
});
describe('Session-scoped voluntary device subscriptions',()=>{
 it('keeps every endpoint disabled before authentication or CSRF without comparison',async()=>{
  h.visible=false;for(const response of [await GET(request()),await POST(request('POST',{})),await DELETE(request('DELETE',{}))])expect(response.status).toBe(404);expect(h.client).not.toHaveBeenCalled();expect(h.csrf).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();
 });
 it('publishes only the public key when current Inbox permission exists',async()=>{
  const response=await GET(request());expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(await response.json()).toEqual({enabled:true,public_key:publicKey});expect(h.manage).not.toHaveBeenCalled();
  h.access={admin:false,sections:['/contactos']};expect((await GET(request())).status).toBe(403);h.access=null;expect((await GET(request())).status).toBe(403);
 });
 it('requires real session and the current selected workspace',async()=>{
  h.user='';expect((await GET(request())).status).toBe(401);h.user='session-actor';expect((await POST(request('POST',{subscription,locale:'en'},other))).status).toBe(409);
  expect((await GET(new Request('https://riverz.test/api/pwa/notifications'))).status).toBe(409);expect(h.manage).not.toHaveBeenCalled();
 });
 it('rejects query-supplied scope, destination headers, extra actors and large bodies',async()=>{
  expect((await GET(new Request('https://riverz.test/api/pwa/notifications?actor=other',{headers:{'x-riverz-workspace':ws}}))).status).toBe(400);
  for(const body of [{subscription,locale:'en',user_id:other},{subscription:{...subscription,headers:{authorization:'private'}},locale:'en'},'x'.repeat(4097)])expect((await POST(request('POST',body))).status).toBe(400);
  expect(h.manage).not.toHaveBeenCalled();
 });
 it('applies CSRF and limits before a mutation',async()=>{
  h.csrf.mockResolvedValue(new Response(null,{status:403}));expect((await POST(request('POST',{subscription,locale:'en'}))).status).toBe(403);expect(h.manage).not.toHaveBeenCalled();h.csrf.mockResolvedValue(null);h.rate.mockResolvedValue({success:false});expect((await POST(request('POST',{subscription,locale:'en'}))).status).toBe(429);expect(h.manage).not.toHaveBeenCalled();
 });
 it('uses only actual server identity for save, even for an agent with Inbox access',async()=>{
  expect((await POST(request('POST',{subscription,locale:'en'}))).status).toBe(200);expect(h.manage).toHaveBeenCalledExactlyOnceWith({private:true},ws,'session-actor','save',subscription.endpoint,'en',subscription);
 });
 it('allows removal of the actor-bound endpoint after Inbox access or keys are revoked',async()=>{
  h.access=null;h.keys.mockReturnValue(null);h.manage.mockResolvedValue({enabled:false});expect((await DELETE(request('DELETE',{endpoint:subscription.endpoint}))).status).toBe(200);expect(h.manage).toHaveBeenCalledWith({private:true},ws,'session-actor','remove',subscription.endpoint);
 });
 it('reports absent VAPID configuration without recording a false subscription',async()=>{
  h.keys.mockReturnValue(null);expect(await (await GET(request())).json()).toEqual({enabled:false,public_key:null});expect((await POST(request('POST',{subscription,locale:'en'}))).status).toBe(503);expect(h.manage).not.toHaveBeenCalled();
 });
});
