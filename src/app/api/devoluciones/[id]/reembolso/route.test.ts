import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const f=vi.hoisted(()=>({enabled:true,locale:'es',session:vi.fn(),csrf:vi.fn(),read:vi.fn(),prepare:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/inbox/server-context',()=>({inboxSession:f.session}));vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/returns/refund-link',async original=>({...await original<typeof import('@/lib/returns/refund-link')>(),readReturnRefundContext:f.read,prepareReturnRefund:f.prepare}));
import {ReturnRefundError} from '@/lib/returns/refund-link';
import {GET,POST} from './route';
const id='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222',receipt='33333333-3333-4333-8333-333333333333';
const route={params:Promise.resolve({id})},body={id:op,receipt_id:receipt,amount:25,reason:'Checked by team'};
const request=(value:unknown=body)=>new Request(`https://riverz.co/api/devoluciones/${id}/reembolso`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.locale='es';f.csrf.mockResolvedValue(null);f.session.mockResolvedValue({db:'database',workspaceId:'trusted-workspace',userId:'trusted-actor'});f.read.mockResolvedValue({case_id:id});f.prepare.mockResolvedValue({operation_id:op,status:'preview'});});
describe('Reserved receipt-linked refund preparation route',()=>{
 it('remains unavailable before session or provider reads outside comparison',async()=>{
  f.enabled=false;expect((await GET(new Request('https://riverz.co'),route)).status).toBe(404);expect((await POST(request(),route)).status).toBe(404);expect(f.session).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 });
 it('uses only the actual session and selected path case for a private read or draft',async()=>{
  const response=await POST(request(),route);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(f.prepare).toHaveBeenCalledExactlyOnceWith('database','trusted-workspace','trusted-actor',id,body);
  expect((await GET(new Request('https://riverz.co'),route)).status).toBe(200);expect(f.read).toHaveBeenCalledExactlyOnceWith('database','trusted-workspace','trusted-actor',id);
 });
 it('requires CSRF and authentication before creating a proposal',async()=>{
  f.csrf.mockResolvedValue(NextResponse.json({error:'blocked'},{status:403}));expect((await POST(request(),route)).status).toBe(403);expect(f.session).not.toHaveBeenCalled();
  f.csrf.mockResolvedValue(null);f.session.mockResolvedValue({response:NextResponse.json({error:'authentication'},{status:401})});expect((await POST(request(),route)).status).toBe(401);expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each([{...body,actor_id:'foreign'},{...body,workspace_id:'foreign'},{...body,order_id:'foreign'},{...body,amount:0},{...body,amount:0.0000001},{...body,provider_confirmed:true}])('rejects scope, money or provenance overrides',async value=>{
  expect((await POST(request(value),route)).status).toBe(400);expect(f.prepare).not.toHaveBeenCalled();
 });
 it('rejects extra query scope and oversized/invalid bodies before preparing',async()=>{
  expect((await GET(new Request('https://riverz.co?actor_id=foreign'),route)).status).toBe(400);expect((await POST(request({...body,reason:'x'.repeat(5000)}),route)).status).toBe(400);
  expect((await POST(new Request('https://riverz.co',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([255])}),route)).status).toBe(400);expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each(['es','en'])('localizes a private failure in %s without provider details',async locale=>{
  f.locale=locale;f.prepare.mockRejectedValue(new Error('SECRET provider response'));const response=await POST(request(),route);expect(response.status).toBe(503);const text=JSON.stringify(await response.json());expect(text).not.toMatch(/SECRET|provider response|returns\./);expect(text).toContain(locale==='es'?'No se pudo':'Could not');
 });
 it.each([['notFound',404],['changed',409],['pending',409],['readOnly',402],['receiptRequired',409]] as const)('returns %s without creating a payment',async(code,status)=>{
  f.prepare.mockRejectedValue(new ReturnRefundError(code));expect((await POST(request(),route)).status).toBe(status);
 });
});
