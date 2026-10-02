import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({enabled:true,auth:vi.fn(),register:vi.fn(),poll:vi.fn(),ack:vi.fn(),release:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/voice/auth',()=>({assertVoiceWorkerAuth:f.auth}));vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>({private:true})}));
vi.mock('@/lib/voice/human-handoff',async original=>({...await original<typeof import('@/lib/voice/human-handoff')>(),registerHumanRuntime:f.register,pollHumanRuntime:f.poll,ackHumanRuntime:f.ack,releaseHumanRuntime:f.release}));
import {POST} from './route';
const callId='11111111-1111-4111-8111-111111111111',workerId='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const post=(body:unknown)=>new Request('https://riverz.co/api/internal/voice/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{f.enabled=true;f.auth.mockReset();for(const fn of [f.register,f.poll,f.ack,f.release])fn.mockReset().mockResolvedValue(true);});
describe('Worker handoff API rejects browsers and hidden-stage traffic',()=>{
 it('does no worker auth/RPC work with the gate off',async()=>{f.enabled=false;expect((await POST(post(null))).status).toBe(404);expect(f.auth).not.toHaveBeenCalled();});
 it('rejects unauthenticated workers before reading the body',async()=>{f.auth.mockImplementation(()=>{throw new Response('Unauthorized',{status:401});});const response=await POST(post(null));expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(f.poll).not.toHaveBeenCalled();});
 it.each([{action:'connected',input:{callId,workerId,id}},{action:'ack',input:{callId,workerId,id,phase:'ready',room:'other'}},{action:'release',input:{callId,workerId,id,actor_id:id}},{action:'poll',input:{callId}},{action:'register',input:{callId,workerId,room:'other/room',customerIdentity:'caller'}}])('rejects fabricated operations/context: %j',async body=>{expect((await POST(post(body))).status).toBe(400);for(const fn of [f.register,f.poll,f.ack,f.release])expect(fn).not.toHaveBeenCalled();});
 it('returns false acknowledgement honestly instead of claiming connection',async()=>{f.ack.mockResolvedValue(false);const response=await POST(post({action:'ack',input:{callId,workerId,id,phase:'connected'}}));expect(response.status).toBe(200);expect(await response.json()).toEqual({acknowledged:false});});
});
