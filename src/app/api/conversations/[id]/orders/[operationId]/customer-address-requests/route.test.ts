import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({enabled:true,ctx:vi.fn(),csrf:vi.fn(),read:vi.fn(),prepare:vi.fn(),locale:'en'}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/lib/inbox/server-context',()=>({inboxConversation:h.ctx}));vi.mock('@/lib/csrf',()=>({csrfGuard:h.csrf}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>h.locale}));
vi.mock('@/lib/channels/webchat/address-requests',async original=>({...await original<object>(),readCaseAddressRequests:h.read,prepareCaseAddressRequest:h.prepare}));
import {GET,POST} from './route';
const conv='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',ws='44444444-4444-4444-8444-444444444444';
const route={params:Promise.resolve({id:conv,operationId:order})};const db={};
function request(body:unknown={id:actor,request_id:order}){return new Request('https://riverz.co/api/conversations/'+conv+'/orders/'+order+'/customer-address-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();h.enabled=true;h.ctx.mockResolvedValue({db,workspaceId:ws,userId:actor,conversation:{id:conv}});h.csrf.mockResolvedValue(null);h.read.mockResolvedValue({requests:[]});h.prepare.mockResolvedValue({operation_id:actor,order_id:order,request_id:order});});
describe('Case preparation keeps real membership and shared engine',()=>{
 it('stays private 404 before auth/CSRF when comparison is off',async()=>{h.enabled=false;expect((await POST(request(),route)).status).toBe(404);expect((await GET(new Request(request().url),route)).status).toBe(404);expect(h.ctx).not.toHaveBeenCalled();expect(h.csrf).not.toHaveBeenCalled();});
 it('uses server actor and the existing order ID route slot',async()=>{expect((await POST(request(),route)).status).toBe(200);expect(h.prepare).toHaveBeenCalledWith(db,ws,actor,conv,order,{id:actor,request_id:order});});
 it('rejects CSRF or session failures before preparing',async()=>{h.csrf.mockResolvedValueOnce(new Response('{}',{status:403}));expect((await POST(request(),route)).status).toBe(403);expect(h.prepare).not.toHaveBeenCalled();h.ctx.mockResolvedValue({response:new Response('{}',{status:401})});expect((await POST(request(),route)).status).toBe(401);expect(h.prepare).not.toHaveBeenCalled();});
 it('rejects query authority and non-JSON requests before the service',async()=>{expect((await GET(new Request(request().url+'?actor_id='+actor),route)).status).toBe(400);expect(h.read).not.toHaveBeenCalled();const bad=new Request(request().url,{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});expect((await POST(bad,route)).status).toBe(400);expect(h.prepare).not.toHaveBeenCalled();});
});
