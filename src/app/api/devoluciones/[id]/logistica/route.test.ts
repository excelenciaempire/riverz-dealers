import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const f=vi.hoisted(()=>({enabled:true,locale:'es',session:vi.fn(),read:vi.fn(),write:vi.fn(),csrf:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/inbox/server-context',()=>({inboxSession:f.session}));
vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/returns/logistics',async original=>({...await original<typeof import('@/lib/returns/logistics')>(),readReturnLogistics:f.read,recordReturnLogistics:f.write}));
import {ReturnLogisticsError} from '@/lib/returns/logistics';
import {GET,POST} from './route';
const caseId='11111111-1111-4111-8111-111111111111',event='22222222-2222-4222-8222-222222222222';
const body={id:event,kind:'guide',payload:{carrier:'Example',tracking_number:'42'},expected_updated_at:'2026-10-01T10:00:00.123456Z'};
const route={params:Promise.resolve({id:caseId})};
const request=(raw:unknown=body)=>new Request(`https://riverz.co/api/devoluciones/${caseId}/logistica`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(raw)});
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.locale='es';f.session.mockResolvedValue({db:'database',workspaceId:'trusted-business',userId:'trusted-actor'});f.csrf.mockResolvedValue(null);f.read.mockResolvedValue({events:[]});f.write.mockResolvedValue({event_id:event,unchanged:false});});
describe('Reserved authenticated return logistics route',()=>{
 it('keeps normal UI/API hidden without authenticating or writing',async()=>{
  f.enabled=false;for(const response of [await GET(new Request('https://riverz.co'),route),await POST(request(),route)]){expect(response.status).toBe(404);expect(response.headers.get('cache-control')).toBe('private, no-store');}
  expect(f.session).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it('requires CSRF and session before a write',async()=>{
  f.csrf.mockResolvedValue(NextResponse.json({error:'blocked'},{status:403}));expect((await POST(request(),route)).status).toBe(403);expect(f.session).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
  f.csrf.mockResolvedValue(null);f.session.mockResolvedValue({response:NextResponse.json({error:'authentication'},{status:401})});expect((await POST(request(),route)).status).toBe(401);expect(f.write).not.toHaveBeenCalled();
 });
 it('uses actual session identity and the path case for reads and writes',async()=>{
  expect((await POST(request(),route)).status).toBe(200);expect(f.write).toHaveBeenCalledExactlyOnceWith('database','trusted-business','trusted-actor',caseId,body);
  expect((await GET(new Request('https://riverz.co?cursor=%7B%22event_sequence%22%3A42%7D'),route)).status).toBe(200);expect(f.read).toHaveBeenCalledExactlyOnceWith('database','trusted-business','trusted-actor',caseId,'{"event_sequence":42}');
 });
 it.each([{...body,actor_id:'foreign'},{...body,workspace_id:'foreign'},{...body,payload:{...body.payload,credential:'SECRET'}},{...body,kind:'carrier_confirmed'}])('rejects client scope/secret/provenance overrides',async raw=>{
  expect((await POST(request(raw),route)).status).toBe(400);expect(f.write).not.toHaveBeenCalled();
 });
 it('rejects oversized bodies and extra query scope before the service',async()=>{
  expect((await POST(request({...body,payload:{carrier:'x'.repeat(9000),tracking_number:'42'}}),route)).status).toBe(400);
  expect((await GET(new Request('https://riverz.co?actor_id=foreign'),route)).status).toBe(400);expect(f.write).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it('rejects invalid UTF-8, JSON, media types and declared sizes',async()=>{
  for(const response of [
   await POST(new Request('https://riverz.co',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([255])}),route),
   await POST(new Request('https://riverz.co',{method:'POST',headers:{'content-type':'application/json'},body:'invalid'}),route),
   await POST(new Request('https://riverz.co',{method:'POST',body:JSON.stringify(body)}),route),
   await POST(new Request('https://riverz.co',{method:'POST',headers:{'content-type':'application/json','content-length':'9000'},body:JSON.stringify(body)}),route),
  ])expect(response.status).toBe(400);
  expect(f.write).not.toHaveBeenCalled();
 });
 it.each(['es','en'])('localizes private failures in %s',async locale=>{
  f.locale=locale;f.write.mockRejectedValue(new Error('SECRET SQL'));const response=await POST(request(),route);expect(response.status).toBe(503);
  const text=JSON.stringify(await response.json());expect(text).not.toMatch(/SECRET|SQL|returns\./);expect(text).toContain(locale==='es'?'No se pudo':'could not');
 });
 it.each([['changed',409],['forbidden',403],['notFound',404],['readOnly',402],['platformManaged',409]] as const)('returns current %s denial',async(code,status)=>{
  f.write.mockRejectedValue(new ReturnLogisticsError(code));expect((await POST(request(),route)).status).toBe(status);
 });
});
