import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const f=vi.hoisted(()=>({enabled:true,locale:'es',user:{id:'actual-actor'} as {id:string}|null,auth:vi.fn(),resolve:vi.fn(),csrf:vi.fn(),read:vi.fn(),write:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:f.auth}})}));vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({id:'trusted-db'})}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:f.resolve}));vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/returns/product-policy',async original=>({...await original<typeof import('@/lib/returns/product-policy')>(),readProductReturnPolicy:f.read,writeProductReturnPolicy:f.write}));
import {ProductPolicyError} from '@/lib/returns/product-policy';
import {GET,POST} from './route';
const product='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',route={params:Promise.resolve({id:product})};
const policy={mode:'allow',window_days:30,starts_at:'delivery',remedies:['refund'],conditions:'Inspected'},body={id,expected_revision:0,policy};
const request=(value:unknown=body)=>new Request(`https://riverz.co/api/products/${product}/return-policy`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.locale='es';f.user={id:'actual-actor'};f.auth.mockImplementation(async()=>({data:{user:f.user}}));f.resolve.mockResolvedValue('selected-workspace');f.csrf.mockResolvedValue(null);f.read.mockResolvedValue({snapshot:{product_id:product},can_edit:true});f.write.mockResolvedValue({product_id:product,revision:1});});
describe('Hidden private product return policy route',()=>{
 it('does no session or product work outside comparison',async()=>{
  f.enabled=false;expect((await GET(new Request('https://riverz.co'),route)).status).toBe(404);expect((await POST(request(),route)).status).toBe(404);expect(f.auth).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
 });
 it('uses the actual session/workspace for the selected product only and disables caching',async()=>{
  const result=await POST(request(),route);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('private, no-store');expect(f.write).toHaveBeenCalledExactlyOnceWith({id:'trusted-db'},'selected-workspace','actual-actor',product,body);
  expect((await GET(new Request('https://riverz.co'),route)).status).toBe(200);expect(f.read).toHaveBeenCalledExactlyOnceWith({id:'trusted-db'},'selected-workspace','actual-actor',product);
 });
 it('requires CSRF and a current authenticated actor',async()=>{
  f.csrf.mockResolvedValueOnce(NextResponse.json({error:'blocked'},{status:403}));expect((await POST(request(),route)).status).toBe(403);expect(f.auth).not.toHaveBeenCalled();f.user=null;expect((await POST(request(),route)).status).toBe(401);expect(f.write).not.toHaveBeenCalled();
 });
 it.each([{...body,actor_id:'foreign'},{...body,workspace_id:'foreign'},{...body,policy:{...policy,provider_confirmed:true}},{...body,expected_revision:-1},{...body,policy:{...policy,window_days:0}}])('rejects authority, provenance and invalid revisions',async value=>{
  expect((await POST(request(value),route)).status).toBe(400);expect(f.write).not.toHaveBeenCalled();
 });
 it('rejects query scope, excessive declared/streamed bytes and invalid UTF-8',async()=>{
  expect((await GET(new Request('https://riverz.co?actor=foreign'),route)).status).toBe(400);expect((await POST(request({...body,policy:{...policy,conditions:'x'.repeat(9000)}}),route)).status).toBe(400);
  expect((await POST(new Request('https://riverz.co',{method:'POST',headers:{'content-type':'application/json','content-length':'9000'},body:'{}'}),route)).status).toBe(400);
  expect((await POST(new Request('https://riverz.co',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([255])}),route)).status).toBe(400);expect(f.write).not.toHaveBeenCalled();
 });
 it.each(['es','en'])('localizes errors and redacts provider detail in %s',async locale=>{
  f.locale=locale;f.write.mockRejectedValue(new Error('PRIVATE_SQL_SECRET'));const response=await POST(request(),route);expect(response.status).toBe(503);const value=JSON.stringify(await response.json());expect(value).toContain(locale==='es'?'No se pudo':'Could not');expect(value).not.toMatch(/PRIVATE|products\./);
 });
 it.each([['changed',409],['notFound',404],['readOnly',402]] as const)('returns %s without writing a policy',async(code,status)=>{
  f.write.mockRejectedValue(new ProductPolicyError(code));expect((await POST(request(),route)).status).toBe(status);
 });
});
