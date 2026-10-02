import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({enabled:true,actor:'11111111-1111-4111-8111-111111111111' as string|null,ws:'22222222-2222-4222-8222-222222222222',locale:'es' as 'es'|'en',member:true,db:{}}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return state.enabled;}}));
vi.mock('@/lib/csrf',()=>({csrfGuard:vi.fn(async()=>null)}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.actor ? { id: state.actor } : null } }) },
  }),
}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>state.db}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>state.locale}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:async()=>state.ws,isMemberOfLiveWorkspace:async()=>state.member}));
vi.mock('@/lib/automations/install-template',async importOriginal=>({...await importOriginal<typeof import('@/lib/automations/install-template')>(),installTemplate:vi.fn(async()=>({id:'draft',name:'Delivery issue',trigger_type:'shopify_order_incident_opened',is_active:false}))}));
import {installTemplate,DeliveryIncidentInstallError} from '@/lib/automations/install-template';
import {BillingReadOnlyError} from '@/lib/billing/read-only';
import {POST} from './route';
const request=(extra:Record<string,unknown>={})=>new Request('https://riverz.co/api/automations/install-from-template',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({template_id:'novedad-entrega',...extra})});
beforeEach(()=>{vi.clearAllMocks();state.enabled=true;state.actor='11111111-1111-4111-8111-111111111111';state.locale='es';state.member=true;vi.mocked(installTemplate).mockResolvedValue({id:'draft',name:'Delivery issue',trigger_type:'shopify_order_incident_opened',is_active:false});});
describe('Delivery issue draft installation route',()=>{
 it('creates an inert draft with session identity, ignoring a client supplied actor',async()=>{
  const response=await POST(request({actorId:state.ws}));expect(response.status).toBe(201);expect(installTemplate).toHaveBeenCalledWith(state.db,{templateId:'novedad-entrega',workspaceId:state.ws,userId:state.actor,actorId:state.actor,locale:'es'});expect(await response.json()).toMatchObject({automation:{is_active:false}});
 });
 it('does not expose or create the new configuration outside comparison',async()=>{state.enabled=false;expect((await POST(request())).status).toBe(404);expect(installTemplate).not.toHaveBeenCalled();});
 it('rejects another workspace without current membership',async()=>{state.member=false;expect((await POST(request({workspace_id:'33333333-3333-4333-8333-333333333333'}))).status).toBe(403);expect(installTemplate).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('localizes administrative and read-only failures in %s without leaking internal errors',async locale=>{
  state.locale=locale;vi.mocked(installTemplate).mockRejectedValueOnce(new DeliveryIncidentInstallError());const forbidden=await POST(request());expect(forbidden.status).toBe(403);expect(await forbidden.json()).toEqual({error:locale==='es'?'Necesitas permiso de administración y acceso a Automatizaciones.':'You need administrator permission and access to Automations.'});
  vi.mocked(installTemplate).mockRejectedValueOnce(new BillingReadOnlyError());expect((await POST(request())).status).toBe(402);
  vi.mocked(installTemplate).mockRejectedValueOnce(new Error('PRIVATE_CREDENTIAL'));const unavailable=await POST(request());expect(unavailable.status).toBe(503);expect(JSON.stringify(await unavailable.json())).not.toContain('PRIVATE_CREDENTIAL');
 });
 it('requires an authenticated actor before installation',async()=>{state.actor=null;state.locale='en';const response=await POST(request());expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'Sign in to continue.'});expect(installTemplate).not.toHaveBeenCalled();});
});
