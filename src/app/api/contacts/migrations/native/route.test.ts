import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',id='11111111-1111-4111-8111-111111111111';
const f=vi.hoisted(()=>({enabled:true,locale:'es',user:{id:'33333333-3333-4333-8333-333333333333'} as {id:string}|null,auth:vi.fn(),resolve:vi.fn(),csrf:vi.fn(),limit:vi.fn(),start:vi.fn(),read:vi.fn(),cancel:vi.fn(),review:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:f.auth}})}));vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({private:true})}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:f.resolve}));vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:f.limit,rateLimitResponse:()=>NextResponse.json({error:'limited'},{status:429})}));
vi.mock('@/lib/migrations/native-contact-source',async original=>({...await original<typeof import('@/lib/migrations/native-contact-source')>(),startNativeContactSource:f.start,readNativeContactSource:f.read,cancelNativeContactSource:f.cancel,prepareNativeContactReview:f.review}));
import {ContactMigrationError} from '@/lib/migrations/contact-import';
import {GET,POST} from './route';
const input={id,provider:'chatwoot',origin:'https://source.example.test',accountId:7,token:'FIXTURE_TOKEN'};
const post=(body:unknown={action:'start',input},workspace=ws)=>new Request('https://riverzai.com/api/contacts/migrations/native',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspace},body:JSON.stringify(body)});
const get=(query='id='+id,workspace=ws)=>new Request('https://riverzai.com/api/contacts/migrations/native?'+query,{headers:{'x-workspace-id':workspace}});
beforeEach(()=>{f.enabled=true;f.locale='es';f.user={id:actor};f.auth.mockReset().mockImplementation(async()=>({data:{user:f.user}}));f.resolve.mockReset().mockResolvedValue(ws);f.csrf.mockReset().mockResolvedValue(null);f.limit.mockReset().mockResolvedValue({success:true});for(const fn of [f.start,f.read,f.cancel,f.review])fn.mockReset().mockResolvedValue({fixture:true});});
describe('Hidden native source API',()=>{
 it('stays closed before reading auth, credentials or body in production',async()=>{f.enabled=false;expect((await POST(post())).status).toBe(404);expect((await GET(get())).status).toBe(404);for(const fn of [f.auth,f.csrf,f.start,f.read])expect(fn).not.toHaveBeenCalled();});
 it('derives current actor and requires the selected workspace header',async()=>{
  const response=await POST(post());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(f.start).toHaveBeenCalledExactlyOnceWith({private:true},ws,actor,input);
  expect((await POST(post(undefined,id))).status).toBe(404);expect((await GET(get('id='+id,''))).status).toBe(404);expect(f.start).toHaveBeenCalledTimes(1);
 });
 it('enforces CSRF before auth for writes and authentication for reads',async()=>{f.csrf.mockResolvedValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await POST(post())).status).toBe(403);expect(f.auth).not.toHaveBeenCalled();f.user=null;expect((await GET(get())).status).toBe(401);});
 it.each([{action:'start',input:{...input,actor_id:actor}},{action:'start',input:{...input,workspace_id:ws}},{action:'start',input:{...input,method:'POST'}},
  {action:'review',input:{id,reviewId:ws,rows:[]}},{action:'review',input:{id,reviewId:id}},{action:'confirm',input:{id}},{action:'cancel',input:{id,workspace_id:ws}}])('rejects forged context, provider writes or implicit import',async body=>{
  expect((await POST(post(body))).status).toBe(400);for(const fn of [f.start,f.cancel,f.review])expect(fn).not.toHaveBeenCalled();
 });
 it('accepts only scoped reads, explicit cancellation and separate review creation',async()=>{
  expect((await GET(get('id='+id+'&after=25'))).status).toBe(200);expect(f.read).toHaveBeenCalledExactlyOnceWith({private:true},ws,actor,{id,after:25});
  expect((await POST(post({action:'cancel',input:{id}}))).status).toBe(200);expect(f.cancel).toHaveBeenCalledExactlyOnceWith({private:true},ws,actor,{id});
  expect((await POST(post({action:'review',input:{id,reviewId:ws}}))).status).toBe(200);expect(f.review).toHaveBeenCalledExactlyOnceWith({private:true},ws,actor,{id,reviewId:ws});
 });
 it.each(['id='+id+'&id='+id,'id='+id+'&after=-1','id='+id+'&after=5001','id='+id+'&token=SECRET','id='+id+'&after=1.5'])('rejects unrecognized or malformed query fields',async query=>{expect((await GET(get(query))).status).toBe(400);expect(f.read).not.toHaveBeenCalled();});
 it('bounds actual body bytes and rate-limits before reading a token',async()=>{
  const request=new Request('https://riverzai.com/api/contacts/migrations/native',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':ws},body:'x'.repeat(65537)});
  expect((await POST(request)).status).toBe(400);expect(f.start).not.toHaveBeenCalled();f.limit.mockResolvedValue({success:false});const response=await POST(post());expect(response.status).toBe(429);expect(response.headers.get('cache-control')).toBe('private, no-store');
 });
 it.each(['es','en'])('redacts and localizes %s failures',async locale=>{f.locale=locale;f.start.mockRejectedValue(new Error('PRIVATE_SECRET'));const response=await POST(post());expect(response.status).toBe(503);expect(await response.text()).not.toMatch(/PRIVATE_SECRET|contacts\.migration/);});
 it('reports revoked access and changed input without exposing database diagnostics',async()=>{f.start.mockRejectedValue(new ContactMigrationError('changed'));expect((await POST(post())).status).toBe(409);f.start.mockRejectedValue(new ContactMigrationError('notFound'));expect((await POST(post())).status).toBe(404);});
});
