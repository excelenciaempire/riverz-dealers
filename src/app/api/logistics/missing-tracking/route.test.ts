import {beforeEach,describe,expect,it,vi} from 'vitest';
const session=vi.hoisted(()=>({actor:'22222222-2222-4222-8222-222222222222',ws:'11111111-1111-4111-8111-111111111111' as string|null,locale:'es' as 'es'|'en',db:{}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:session.actor}}})}})}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>session.db}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:async()=>session.ws}));
vi.mock('@/lib/csrf',()=>({csrfGuard:vi.fn(async()=>null)}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>session.locale}));
vi.mock('@/lib/logistics/access',async importOriginal=>({...await importOriginal<typeof import('@/lib/logistics/access')>(),logisticsAccess:vi.fn(async()=>({inbox:true,voice:true}))}));
vi.mock('@/lib/billing/read-only',async importOriginal=>({...await importOriginal<typeof import('@/lib/billing/read-only')>(),assertWorkspaceWritable:vi.fn(async()=>{})}));
vi.mock('@/lib/logistics/missing-tracking',()=>({listOrdersMissingTracking:vi.fn(async()=>[{id:'PRIVATE_CASE'}]),recordManualTracking:vi.fn(async()=>'sent'),dismissMissingTracking:vi.fn(async()=>true)}));
import {logisticsAccess,LogisticsAccessError} from '@/lib/logistics/access';
import {assertWorkspaceWritable,BillingReadOnlyError} from '@/lib/billing/read-only';
import {listOrdersMissingTracking,recordManualTracking,dismissMissingTracking} from '@/lib/logistics/missing-tracking';
import {GET,POST} from './route';
const orderId='33333333-3333-4333-8333-333333333333';
const request=(extra:Record<string,unknown>={})=>new Request('https://riverz.co/api/logistics/missing-tracking',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId,trackingNumber:'001234',carrier:'ENVIA',...extra})});
beforeEach(()=>{vi.clearAllMocks();session.ws='11111111-1111-4111-8111-111111111111';session.locale='es';vi.mocked(logisticsAccess).mockResolvedValue({inbox:true,voice:true});vi.mocked(assertWorkspaceWritable).mockResolvedValue();vi.mocked(recordManualTracking).mockResolvedValue('sent');});
describe('Orders permission on logistics routes',()=>{
 it('checks current Orders access before loading any private order',async()=>{
  vi.mocked(logisticsAccess).mockRejectedValueOnce(new LogisticsAccessError());const response=await GET();expect(response.status).toBe(403);expect(listOrdersMissingTracking).not.toHaveBeenCalled();expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_CASE');
 });
 it('does not return loaded order bodies after membership revocation',async()=>{
  vi.mocked(logisticsAccess).mockResolvedValueOnce({inbox:true,voice:true}).mockRejectedValueOnce(new LogisticsAccessError());const response=await GET();expect(response.status).toBe(403);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_CASE');
 });
 it('returns private uncached reads to the actual selected actor',async()=>{
  const response=await GET();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(logisticsAccess).toHaveBeenCalledWith(session.db,session.ws,session.actor);
 });
 it.each(['es','en'] as const)('localizes forbidden writes in %s and never starts side effects',async locale=>{
  session.locale=locale;vi.mocked(logisticsAccess).mockRejectedValueOnce(new LogisticsAccessError());const response=await POST(request());expect(response.status).toBe(403);expect(await response.json()).toEqual({error:locale==='es'?'No tienes permiso para acceder a esta operación.':'You do not have permission to access this operation.'});expect(recordManualTracking).not.toHaveBeenCalled();expect(dismissMissingTracking).not.toHaveBeenCalled();
 });
 it('derives write identity from the session, ignoring a supplied actor/workspace',async()=>{
  expect((await POST(request({actorId:orderId,workspaceId:orderId}))).status).toBe(200);
  expect(logisticsAccess).toHaveBeenCalledWith(session.db,session.ws,session.actor,true);
  expect(recordManualTracking).toHaveBeenCalledWith(session.db,{workspaceId:session.ws,actorId:session.actor,orderId,trackingNumber:'001234',carrier:'ENVIA'});
 });
 it('binds a dismissal to the same actual actor',async()=>{
  expect((await POST(request({dismiss:true}))).status).toBe(200);expect(dismissMissingTracking).toHaveBeenCalledWith(session.db,session.ws,orderId,session.actor);
 });
 it('preserves read-only billing and handles revocation inside the service',async()=>{
  vi.mocked(assertWorkspaceWritable).mockRejectedValueOnce(new BillingReadOnlyError());expect((await POST(request())).status).toBe(402);expect(recordManualTracking).not.toHaveBeenCalled();
  vi.mocked(recordManualTracking).mockRejectedValueOnce(new LogisticsAccessError());expect((await POST(request())).status).toBe(403);
 });
 it('requires a live selected workspace',async()=>{session.ws=null;expect((await GET()).status).toBe(401);expect((await POST(request())).status).toBe(401);expect(logisticsAccess).not.toHaveBeenCalled();});
});
