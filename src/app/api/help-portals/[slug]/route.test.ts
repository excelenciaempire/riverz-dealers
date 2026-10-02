import {beforeEach,describe,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({enabled:true,rate:true,load:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=> 'en'}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>{h.admin();return {};}}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:async()=>({success:h.rate}),clientIp:()=> '127.0.0.1',rateLimitResponse:()=>new Response('{}',{status:429})}));
vi.mock('@/lib/help-portal/service',async()=>({...await vi.importActual<typeof import('@/lib/help-portal/service')>('@/lib/help-portal/service'),loadPublicPortal:h.load}));
import {GET,POST} from './route';
const ctx={params:Promise.resolve({slug:'fixture-shop'})},url='https://riverz.co/api/help-portals/fixture-shop';
beforeEach(()=>{vi.clearAllMocks();h.enabled=true;h.rate=true;h.load.mockResolvedValue(null);});
describe('Public help center minimal read',()=>{
 it('rejects cross-origin feedback and an oversized JSON body before recording any event',async()=>{
  expect((await POST(new Request(url,{method:'POST',headers:{Origin:'https://foreign.test','Content-Type':'application/json'},body:'{}'}),ctx)).status).toBe(403);
  expect((await POST(new Request(url,{method:'POST',headers:{Origin:'https://riverz.co','Content-Type':'application/json'},body:'x'.repeat(4097)}),ctx)).status).toBe(400);
  expect(h.admin).not.toHaveBeenCalled();
 });
 it('keeps public reads closed with the comparison off',async()=>{h.enabled=false;expect((await GET(new Request(url),ctx)).status).toBe(404);expect(h.admin).not.toHaveBeenCalled();});
 it('rejects identity injection and duplicate languages without any database call',async()=>{
  for(const query of ['?workspace_id=foreign','?locale=en&locale=es'])expect((await GET(new Request(url+query),ctx)).status).toBe(400);
  expect(h.load).not.toHaveBeenCalled();
 });
 it('rate-limits anonymous reads and treats unpublished/not-found alike',async()=>{
  expect((await GET(new Request(url),ctx)).status).toBe(404);h.rate=false;expect((await GET(new Request(url),ctx)).status).toBe(429);
  expect(h.load).toHaveBeenCalledTimes(1);
 });
 it('returns only the checked projection with no-store and no-referrer',async()=>{
  const body={slug:'fixture-shop',brand:{name:'Fixture',description:'Help',accent:'#123456'},locale:'en',articles:[]};h.load.mockResolvedValue(body);
  const result=await GET(new Request(url+'?locale=en'),ctx);expect(result.status).toBe(200);expect(await result.json()).toEqual(body);
  expect(result.headers.get('Cache-Control')).toBe('no-store');expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
 });
});
