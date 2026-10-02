import {beforeEach,describe,it,expect,vi} from 'vitest';
const ws='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222';
const h=vi.hoisted(()=>({enabled:true,allowed:true,configured:true,guard:vi.fn(),load:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/lib/channels/webchat/guard',()=>({requireSession:h.guard}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>({})}));
vi.mock('@/lib/help-portal/service',async()=>({...await vi.importActual<typeof import('@/lib/help-portal/service')>('@/lib/help-portal/service'),loadWidgetPortal:h.load}));
import {GET} from './route';
const url='https://riverz.co/api/widget/help-portal';
beforeEach(()=>{vi.clearAllMocks();h.enabled=true;h.guard.mockResolvedValue({ok:true,session:{workspaceId:ws,visitorId:'signed-visitor'},ctx:{config:{agent_id:agent}}});h.load.mockResolvedValue({portal:{},orders:[]});});
describe('Help center orders use current signed visitor authority',()=>{
 it('keeps new widget UI closed with no session processing when disabled',async()=>{h.enabled=false;expect((await GET(new Request(url))).status).toBe(404);expect(h.guard).not.toHaveBeenCalled();});
 it('rejects guessed customer/order/tenant identifiers and repeated locale parameters',async()=>{
  for(const query of ['?contact_id=other','?order_id=123','?workspace_id=foreign','?locale=en&locale=es','?locale=fr'])expect((await GET(new Request(url+query))).status).toBe(400);
  expect(h.guard).not.toHaveBeenCalled();expect(h.load).not.toHaveBeenCalled();
 });
 it('derives business, exact visitor and current assistant from signed guard context',async()=>{
  const result=await GET(new Request(url+'?locale=en'));expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toContain('no-store');
  expect(h.load).toHaveBeenCalledWith({},ws,agent,'signed-visitor','en');
 });
 it('honors expired/revoked session and does not select an arbitrary assistant when none is configured',async()=>{
  h.guard.mockResolvedValue({ok:false,response:new Response('{}',{status:401})});expect((await GET(new Request(url))).status).toBe(401);expect(h.load).not.toHaveBeenCalled();
  h.guard.mockResolvedValue({ok:true,session:{workspaceId:ws,visitorId:'signed-visitor'},ctx:{config:{}}});expect((await GET(new Request(url))).status).toBe(404);expect(h.load).not.toHaveBeenCalled();
 });
});
