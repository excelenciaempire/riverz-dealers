import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({enabled:true,guard:vi.fn(),reserve:vi.fn(),submit:vi.fn(),read:vi.fn(),send:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/lib/channels/webchat/guard',()=>({requireSession:h.guard}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:h.admin}));
vi.mock('@/lib/channels/webchat/address-requests',async original=>({...await original<object>(),reserveAddressRequest:h.reserve,submitAddressRequest:h.submit,readAddressRequestReceipt:h.read}));
vi.mock('../messages/route',()=>({POST:h.send}));
import { GET, POST } from './route';
const id='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',connection='33333333-3333-4333-8333-333333333333';
const address={address1:'42 Test',address2:'',city:'Test',province:'',zip:'',countryCode:'US'};
const input={id,order_id:order,address,confirmed:true,locale:'en'},session={workspaceId:order,visitorId:'signed',origin:'https://shop.example',exp:Date.now()+60000};
const receipt={id,reference:'#42',created_at:'2026-10-01T12:00:00Z',status:'waiting_review',confirmed_at:null,superseded:false};
function request(body:unknown=input){return new Request('https://riverz.co/api/widget/order-address-requests',{method:'POST',headers:{Authorization:'Bearer signed-token',Origin:'https://shop.example','Content-Type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();h.enabled=true;h.admin.mockReturnValue({});h.guard.mockResolvedValue({ok:true,session,ctx:{connection:{id:connection}}});h.reserve.mockResolvedValue({receipt:{...receipt,status:'not_submitted'},text:'CANONICAL CUSTOMER REQUEST'});h.submit.mockResolvedValue(receipt);h.read.mockResolvedValue(receipt);h.send.mockResolvedValue(new Response('{"ok":true}',{status:200}));});
describe('Widget request route retains signed ingress and execution separation',()=>{
 it('is a private 404 before guards and database work when comparison is off',async()=>{h.enabled=false;expect((await POST(request())).status).toBe(404);expect((await GET(new Request('https://riverz.co/api/widget/order-address-requests'))).status).toBe(404);expect(h.guard).not.toHaveBeenCalled();expect(h.reserve).not.toHaveBeenCalled();});
 it('preserves original token/origin and stable external message ID in the existing sender',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
  const forwarded=h.send.mock.calls[0][0] as Request;expect(forwarded.headers.get('authorization')).toBe('Bearer signed-token');expect(forwarded.headers.get('origin')).toBe('https://shop.example');
  expect(await forwarded.json()).toEqual({text:'CANONICAL CUSTOMER REQUEST',clientMessageId:id});expect(h.submit).toHaveBeenCalledWith({},session,connection,id);expect(await response.json()).toMatchObject({status:'waiting_review',confirmed_at:null});
 });
 it('does not send a new message when recovering an already submitted receipt',async()=>{h.reserve.mockResolvedValue({receipt,text:'SAME'});expect((await POST(request())).status).toBe(200);expect(h.send).not.toHaveBeenCalled();expect(h.submit).not.toHaveBeenCalled();});
 it('does not publish a request when ingress failed or did not acknowledge persistence',async()=>{h.send.mockResolvedValueOnce(new Response('{"error":"ingest_failed"}',{status:502}));const failed=await POST(request());expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('ingest_failed');expect(h.submit).not.toHaveBeenCalled();h.send.mockResolvedValueOnce(new Response('{}'));expect((await POST(request())).status).toBe(503);expect(h.submit).not.toHaveBeenCalled();});
 it('rejects authority, missing consent, oversized text and invalid UTF-8 before reservation',async()=>{
  for(const body of [{...input,actor_id:id},{...input,confirmed:false},{...input,address:{...address,address1:'x'.repeat(256)}}])expect((await POST(request(body))).status).toBe(400);
  const oversized=new Request(request().url,{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(8193)});expect((await POST(oversized)).status).toBe(400);
  const invalid=new Request(request().url,{method:'POST',headers:{'Content-Type':'application/json'},body:new Uint8Array([0xff])});expect((await POST(invalid)).status).toBe(400);expect(h.reserve).not.toHaveBeenCalled();
 });
 it('limits reads to the signed visitor, rejects duplicate query keys and foreign fields',async()=>{
  expect((await GET(new Request(`https://riverz.co/api/widget/order-address-requests?id=${id}&locale=en`))).status).toBe(200);expect(h.read).toHaveBeenCalledWith({},session,connection,id);
  for(const suffix of ['&id='+id,'&actor_id='+id])expect((await GET(new Request(`https://riverz.co/api/widget/order-address-requests?id=${id}&locale=en${suffix}`))).status).toBe(400);
 });
 it('propagates current signed session failures before ingestion',async()=>{h.guard.mockResolvedValue({ok:false,response:new Response('{}',{status:401})});expect((await POST(request())).status).toBe(401);expect(h.reserve).not.toHaveBeenCalled();});
});
