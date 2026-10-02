import {beforeEach,describe,expect,it,vi} from 'vitest';
const id='11111111-1111-4111-8111-111111111111';
const f=vi.hoisted(()=>({enabled:true,auth:vi.fn(),observe:vi.fn(),end:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/voice/auth',()=>({assertVoiceWorkerAuth:f.auth}));vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>({private:true})}));
vi.mock('@/lib/voice/whatsapp-calling-service',()=>({observeWhatsAppVoiceCustomer:f.observe,endWhatsAppVoiceCall:f.end}));
import {POST} from './route';
const body={action:'observe',callId:id,room:'voice_'+id,customerIdentity:'whatsapp-'+id};
const post=(value:unknown=body)=>new Request('https://riverz.co/api/internal/voice/whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{f.enabled=true;f.auth.mockReset();f.observe.mockReset().mockResolvedValue({observed:true});f.end.mockReset().mockResolvedValue({accepted:true});});
describe('Worker-only WhatsApp media observer/end',()=>{
 it('is hidden before authentication or parsing',async()=>{f.enabled=false;expect((await POST(post())).status).toBe(404);expect(f.auth).not.toHaveBeenCalled();expect(f.observe).not.toHaveBeenCalled();});
 it('requires the worker credential and marks failures no-store',async()=>{f.auth.mockImplementation(()=>{throw new Response('Unauthorized',{status:401});});const response=await POST(post());expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');expect(f.observe).not.toHaveBeenCalled();});
 it('binds the observer to explicit call/room/customer coordinates',async()=>{expect((await POST(post())).status).toBe(200);expect(f.observe).toHaveBeenCalledExactlyOnceWith({private:true},id,'voice_'+id,'whatsapp-'+id);expect(f.end).not.toHaveBeenCalled();});
 it('does not end a connector from an observation action',async()=>{expect((await POST(post({...body,action:'end'}))).status).toBe(200);expect(f.end).toHaveBeenCalledExactlyOnceWith({private:true},id,'voice_'+id,'whatsapp-'+id);expect(f.observe).not.toHaveBeenCalled();});
 it.each(['token','workspaceId','peer','providerCallId'])('rejects caller-controlled %s',async key=>{expect((await POST(post({...body,[key]:'FORGED'}))).status).toBe(400);expect(f.observe).not.toHaveBeenCalled();});
 it('rejects malformed/oversized streamed bodies before media actions',async()=>{for(const value of ['{','x'.repeat(1025)]){const request=new Request('https://riverz.co/api/internal/voice/whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:value});expect((await POST(request)).status).toBe(400);}expect(f.observe).not.toHaveBeenCalled();});
 it('does not expose provider failures as success or return their content',async()=>{f.observe.mockRejectedValue(new Error('PRIVATE_PROVIDER_TOKEN'));const response=await POST(post());expect(response.status).toBe(409);expect(await response.text()).not.toContain('PRIVATE_PROVIDER_TOKEN');});
});
