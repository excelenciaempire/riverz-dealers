import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
import {translate} from '@/lib/i18n/translate';
const f=vi.hoisted(()=>({enabled:true,admin:true,user:{id:'actor'},locale:'es' as 'es'|'en',csrf:vi.fn(),gate:vi.fn(),write:vi.fn(),readError:false,writeError:false}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:f.user}})}})}));
vi.mock('@/lib/voice/voice-connection-store',()=>({isVoiceAdmin:async()=>f.admin}));
vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));
vi.mock('@/lib/wallet/puerta',()=>({exigirMensualidad:f.gate}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/api/errors',()=>({serverError:()=>NextResponse.json({error:'unavailable'},{status:500})}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>({from:()=>{
 const q:Record<string,unknown>={};q.select=()=>q;q.eq=()=>q;q.maybeSingle=async()=>({data:{id:'connection',config:{phone_number:'+12025550123',country:'US',telnyx_number_id:'existing',recording_enabled:false,fallback_transfer_number:'+13055550123',reserved_inbound_slots:1}},error:f.readError?{message:'private'}:null});
 q.update=(value:unknown)=>{f.write(value);return q;};q.insert=(value:unknown)=>{f.write(value);return q;};q.then=(resolve:(v:unknown)=>unknown)=>resolve({error:f.writeError?{message:'private'}:null});return q;
}})}));
import {PUT} from './route';
function request(config:unknown={fallback_voicemail_enabled:true,fallback_voicemail_seconds:60}) {return new Request('https://riverz.co/api/voice/connection',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:'workspace',config})});}
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.admin=true;f.locale='es';f.readError=false;f.writeError=false;f.csrf.mockResolvedValue(null);f.gate.mockResolvedValue(null);});
describe('recorded inbound fallback config stays explicit and preserves current voice',()=>{
 it('merges only mailbox options, retaining transfer, number and recording choices',async()=>{
  const response=await PUT(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(f.write.mock.calls[0][0].config).toMatchObject({phone_number:'+12025550123',country:'US',telnyx_number_id:'existing',recording_enabled:false,fallback_transfer_number:'+13055550123',fallback_voicemail_enabled:true,fallback_voicemail_seconds:60});
 });
 it('rejects hidden controls in the normal build without writing',async()=>{f.enabled=false;expect((await PUT(request())).status).toBe(404);expect(f.write).not.toHaveBeenCalled();});
 it('keeps the current form working without new keys in the normal build',async()=>{f.enabled=false;expect((await PUT(request({fallback_language:'en'}))).status).toBe(200);expect(f.gate).not.toHaveBeenCalled();});
 it('requires administrator and CSRF before any config write',async()=>{f.admin=false;expect((await PUT(request())).status).toBe(403);expect(f.write).not.toHaveBeenCalled();f.admin=true;f.csrf.mockResolvedValue(new Response(null,{status:403}));expect((await PUT(request())).status).toBe(403);expect(f.write).not.toHaveBeenCalled();});
 it.each([14,121,'60',60.5,null])('rejects unsafe duration %s',async value=>{expect((await PUT(request({fallback_voicemail_enabled:true,fallback_voicemail_seconds:value}))).status).toBe(400);expect(f.write).not.toHaveBeenCalled();});
 it.each([null,'true',1])('rejects coercion of recording permission %s',async value=>{expect((await PUT(request({fallback_voicemail_enabled:value}))).status).toBe(400);expect(f.write).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('blocks unpaid writes with localized %s error',async locale=>{f.locale=locale;f.gate.mockResolvedValue(new Response(null,{status:402}));const response=await PUT(request());expect(response.status).toBe(402);expect((await response.json()).error).toBe(translate(locale,'voice.handoffError_readOnly'));expect(f.write).not.toHaveBeenCalled();});
 it('does not overwrite current settings if their read failed',async()=>{f.readError=true;expect((await PUT(request())).status).toBe(500);expect(f.write).not.toHaveBeenCalled();});
 it('does not claim the config saved if the database rejected the update',async()=>{f.writeError=true;expect((await PUT(request())).status).toBe(500);});
});
