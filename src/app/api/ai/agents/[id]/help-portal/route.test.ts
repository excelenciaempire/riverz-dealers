import {beforeEach,describe,it,expect,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333';
const h=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en',user:true,workspace:'11111111-1111-4111-8111-111111111111',csrf:false,rate:true,read:vi.fn(),manage:vi.fn(),auth:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>h.locale}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>{h.auth();return {data:{user:h.user?{id:actor}:null}};}}})}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:async()=>h.workspace}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>{h.admin();return {};}}));
vi.mock('@/lib/csrf',()=>({csrfGuard:async()=>h.csrf?new Response('{}',{status:403}):null}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:async()=>({success:h.rate}),rateLimitResponse:()=>new Response('{}',{status:429})}));
vi.mock('@/lib/help-portal/service',async()=>({...await vi.importActual<typeof import('@/lib/help-portal/service')>('@/lib/help-portal/service'),readHelpPortal:h.read,manageHelpPortal:h.manage}));
import {GET,POST} from './route';
const ctx={params:Promise.resolve({id:agent})},url=`https://riverz.co/api/ai/agents/${agent}/help-portal`;
const request=(method='GET',body?:string,path=url)=>new Request(path,{method,headers:{'x-workspace-id':ws,'Content-Type':'application/json'},...(body?{body}:{})});
beforeEach(()=>{vi.clearAllMocks();Object.assign(h,{enabled:true,locale:'es',user:true,workspace:ws,csrf:false,rate:true});h.read.mockResolvedValue(null);h.manage.mockResolvedValue(null);});
describe('Hidden reviewed help portal API',()=>{
 it('returns 404 with the feature off before authentication, reads or writes',async()=>{
  h.enabled=false;expect((await GET(request(),ctx)).status).toBe(404);expect((await POST(request('POST','{}'),ctx)).status).toBe(404);
  expect(h.auth).not.toHaveBeenCalled();expect(h.admin).not.toHaveBeenCalled();expect(h.manage).not.toHaveBeenCalled();
 });
 it('rejects wrong selected business, missing session and foreign browser selectors',async()=>{
  h.workspace=actor;expect((await GET(request(),ctx)).status).toBe(404);h.workspace=ws;h.user=false;expect((await GET(request(),ctx)).status).toBe(404);
  h.user=true;expect((await GET(request('GET',undefined,url+'?workspace_id='+actor),ctx)).status).toBe(400);expect(h.read).not.toHaveBeenCalled();
 });
 it('passes actual identity and assistant binding and returns no-store',async()=>{
  const result=await GET(request(),ctx);expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toContain('no-store');
  expect(h.read).toHaveBeenCalledWith({}, {workspaceId:ws,actorId:actor,agentId:agent});
 });
 it('blocks CSRF and rate limits before any mutation',async()=>{
  h.csrf=true;expect((await POST(request('POST','{}'),ctx)).status).toBe(403);h.csrf=false;h.rate=false;
  expect((await POST(request('POST','{}'),ctx)).status).toBe(429);expect(h.manage).not.toHaveBeenCalled();
 });
 it.each(['es','en'] as const)('localizes bounded malformed body failures in %s',async locale=>{
  h.locale=locale;for(const body of ['{','x'.repeat(65537)]){
   const result=await POST(request('POST',body),ctx);expect(result.status).toBe(400);expect(await result.json()).toMatchObject({code:'portal_invalid',error:translate(locale,'assistant.portal_invalid')});
  }expect(h.manage).not.toHaveBeenCalled();
 });
});
