import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',id='11111111-1111-4111-8111-111111111111';
const f=vi.hoisted(()=>({enabled:true,locale:'es',user:{id:'33333333-3333-4333-8333-333333333333'} as {id:string}|null,auth:vi.fn(),resolve:vi.fn(),csrf:vi.fn(),limit:vi.fn(),prepare:vi.fn(),confirm:vi.fn(),read:vi.fn(),report:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:f.auth}})}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({id:'trusted-db'})}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:f.resolve}));vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:f.limit,rateLimitResponse:()=>NextResponse.json({error:'limited'},{status:429})}));
vi.mock('@/lib/migrations/contact-import',async original=>({...await original<typeof import('@/lib/migrations/contact-import')>(),prepareContactMigration:f.prepare,confirmContactMigration:f.confirm,readContactMigration:f.read,readContactMigrationResults:f.report}));
import {ContactMigrationError} from '@/lib/migrations/contact-import';
import {GET,POST} from './route';
const input={id,provider:'chatwoot',account:'Fixture',csv:'id,phone\na,+573001112233',mapping:{sourceId:0,phone:1,name:-1,email:-1,company:-1}};
const request=(body:unknown={action:'prepare',input},workspace=ws)=>new Request('https://riverzai.com/api/contacts/migrations',{method:'POST',headers:{'content-type':'application/json','x-workspace-id':workspace},body:JSON.stringify(body)});
const get=(query='id='+id,workspace=ws)=>new Request('https://riverzai.com/api/contacts/migrations?'+query,{headers:{'x-workspace-id':workspace}});
beforeEach(()=>{
 f.enabled=true;f.locale='es';f.user={id:actor};f.auth.mockReset().mockImplementation(async()=>({data:{user:f.user}}));f.resolve.mockReset().mockResolvedValue(ws);f.csrf.mockReset().mockResolvedValue(null);
 f.limit.mockReset().mockResolvedValue({success:true});for(const operation of [f.prepare,f.confirm,f.read,f.report])operation.mockReset().mockResolvedValue({fixture:true});
});
describe('Private contact migration API',()=>{
 it('returns 404 outside comparison before reading a session, body or database',async()=>{
  f.enabled=false;expect((await POST(request())).status).toBe(404);expect((await GET(get())).status).toBe(404);expect(f.auth).not.toHaveBeenCalled();expect(f.csrf).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 });
 it('derives the actor from the session and requires the currently selected workspace header',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(f.prepare).toHaveBeenCalledExactlyOnceWith({id:'trusted-db'},ws,actor,input);
  expect((await POST(request(undefined,id))).status).toBe(404);expect((await GET(get('id='+id,''))).status).toBe(404);expect(f.prepare).toHaveBeenCalledTimes(1);
 });
 it('requires CSRF before auth for writes and an authenticated actor for reads',async()=>{
  f.csrf.mockResolvedValueOnce(NextResponse.json({error:'csrf_mismatch'},{status:403}));expect((await POST(request())).status).toBe(403);expect(f.auth).not.toHaveBeenCalled();
  f.user=null;expect((await POST(request())).status).toBe(401);expect((await GET(get())).status).toBe(401);expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each([{action:'prepare',input:{...input,actor_id:actor}},{action:'prepare',input:{...input,workspace_id:ws}},{action:'prepare',input,confirmed:true},
  {action:'confirm',input:{id,revision:'a'.repeat(64),confirmed:false}},{action:'confirm',input:{id,revision:'a'.repeat(64)}}])('rejects injected scope and implicit approval',async value=>{
  expect((await POST(request(value))).status).toBe(400);expect(f.prepare).not.toHaveBeenCalled();expect(f.confirm).not.toHaveBeenCalled();
 });
 it('accepts only explicit confirmation and paged reads of the current actor’s own receipt',async()=>{
  const confirmation={id,revision:'a'.repeat(64),confirmed:true};expect((await POST(request({action:'confirm',input:confirmation}))).status).toBe(200);
  expect(f.confirm).toHaveBeenCalledExactlyOnceWith({id:'trusted-db'},ws,actor,confirmation);
  expect((await GET(get('id='+id+'&after=26'))).status).toBe(200);expect(f.read).toHaveBeenCalledExactlyOnceWith({id:'trusted-db'},ws,actor,{id,after:26});
  expect((await GET(get('id='+id+'&results=true'))).status).toBe(200);expect(f.report).toHaveBeenCalledExactlyOnceWith({id:'trusted-db'},ws,actor,{id,after:0});
 });
 it.each(['id='+id+'&workspace_id='+ws,'id='+id+'&id='+id,'id='+id+'&after=-1','id='+id+'&results=false','id='+id+'&after=1.2'])('rejects malformed or repeated query scope',async query=>{
  expect((await GET(get(query))).status).toBe(400);expect(f.read).not.toHaveBeenCalled();
 });
 it('enforces the budget before body parsing and disables cache on the rate response',async()=>{
  f.limit.mockResolvedValue({success:false});const response=await POST(request());expect(response.status).toBe(429);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(f.prepare).not.toHaveBeenCalled();
 });
 it('rejects oversized declared or streamed bytes and invalid UTF-8',async()=>{
  for(const body of [new Uint8Array([255]),'x'.repeat(13*1024*1024+1)]){
   const response=await POST(new Request('https://riverzai.com/api/contacts/migrations',{method:'POST',headers:{'content-type':'application/json','x-workspace-id':ws},body}));expect(response.status).toBe(400);
  }
  const response=await POST(new Request('https://riverzai.com/api/contacts/migrations',{method:'POST',headers:{'content-type':'application/json','x-workspace-id':ws,'content-length':'99999999'},body:'{}'}));expect(response.status).toBe(400);expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each(['es','en'])('localizes %s errors and redacts service details',async locale=>{
  f.locale=locale;f.prepare.mockRejectedValue(new Error('PRIVATE_DB_SECRET'));const response=await POST(request());expect(response.status).toBe(503);const body=JSON.stringify(await response.json());expect(body).not.toMatch(/PRIVATE_DB_SECRET|contacts\.migration/);
 });
 it.each([['changed',409],['expired',409],['readOnly',402],['notFound',404],['limit',429]] as const)('maps %s to %s without leaking database output',async(code,status)=>{
  f.prepare.mockRejectedValue(new ContactMigrationError(code));expect((await POST(request())).status).toBe(status);
 });
});
