import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',id='11111111-1111-4111-8111-111111111111';
const f=vi.hoisted(()=>({enabled:true,locale:'es',user:{id:'33333333-3333-4333-8333-333333333333'} as {id:string}|null,auth:vi.fn(),resolve:vi.fn(),csrf:vi.fn(),limit:vi.fn(),start:vi.fn(),read:vi.fn(),cancel:vi.fn(),confirm:vi.fn(),messages:vi.fn(),file:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:f.auth}})}));vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({private:true})}));
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:f.resolve}));vi.mock('@/lib/csrf',()=>({csrfGuard:f.csrf}));vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>f.locale}));
vi.mock('@/lib/rate-limit',()=>({limitByKey:f.limit,rateLimitResponse:()=>NextResponse.json({error:'limited'},{status:429})}));
vi.mock('@/lib/migrations/archive-service',()=>({startNativeHistoryArchive:f.start,readNativeHistoryArchive:f.read,cancelNativeHistoryArchive:f.cancel,confirmNativeHistoryArchive:f.confirm,readNativeHistoryMessages:f.messages,readNativeHistoryFile:f.file}));
import {GET,POST} from './route';
const input={id,receiptId:ws,provider:'chatwoot',origin:'https://source.example.test',accountId:7,token:'FIXTURE_TOKEN'};
const post=(body:unknown={action:'start',input},workspace=ws)=>new Request('https://riverzai.com/api/contacts/migrations/history',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspace},body:JSON.stringify(body)});
const get=(query='id='+id,workspace=ws)=>new Request('https://riverzai.com/api/contacts/migrations/history?'+query,{headers:{'x-workspace-id':workspace}});
beforeEach(()=>{f.enabled=true;f.locale='es';f.user={id:actor};f.auth.mockReset().mockImplementation(async()=>({data:{user:f.user}}));f.resolve.mockReset().mockResolvedValue(ws);f.csrf.mockReset().mockResolvedValue(null);f.limit.mockReset().mockResolvedValue({success:true});for(const fn of [f.start,f.read,f.cancel,f.confirm,f.messages])fn.mockReset().mockResolvedValue({fixture:true});f.file.mockReset().mockResolvedValue({buffer:Buffer.from('PRIVATE_FIXTURE'),mime:'text/plain',fileId:'99'});});
describe('Hidden private archive API',()=>{
 it('is closed before auth, body or credentials in production',async()=>{f.enabled=false;expect((await POST(post())).status).toBe(404);expect((await GET(get())).status).toBe(404);for(const fn of [f.auth,f.csrf,f.start,f.read,f.file])expect(fn).not.toHaveBeenCalled();});
 it('derives current actor and requires exact selected workspace',async()=>{
  expect((await POST(post())).status).toBe(200);expect(f.start).toHaveBeenCalledExactlyOnceWith({private:true},ws,actor,{...input,after:null});
  expect((await GET(get('id='+id,id))).status).toBe(404);expect(f.read).not.toHaveBeenCalled();
 });
 it('enforces CSRF and current login',async()=>{f.csrf.mockResolvedValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await POST(post())).status).toBe(403);expect(f.auth).not.toHaveBeenCalled();f.user=null;expect((await GET(get())).status).toBe(401);});
 it.each([{action:'start',input:{...input,rows:[]}},{action:'start',input:{...input,actor_id:actor}},{action:'confirm',input:{id,revision:'a'.repeat(64),confirmed:false}},{action:'delete',input:{id,workspace_id:ws}}])('rejects replacement history or forged authority',async body=>{
  expect((await POST(post(body))).status).toBe(400);for(const fn of [f.start,f.confirm,f.cancel])expect(fn).not.toHaveBeenCalled();
 });
 it('reads scoped bounded messages and serves bytes only as non-cacheable downloads',async()=>{
  expect((await GET(get(`id=${id}&view=messages&after=20`))).status).toBe(200);expect(f.messages).toHaveBeenCalledExactlyOnceWith({private:true},ws,actor,{id,after:20});
  const response=await GET(get(`id=${id}&view=file&fileId=99`));expect(response.headers.get('content-disposition')).toBe('attachment; filename="archive-99"');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.text()).toBe('PRIVATE_FIXTURE');
 });
 it.each([`id=${id}&id=${id}`,`id=${id}&view=file&url=https://foreign.test`,`id=${id}&view=messages&after=10001`,`id=${id}&view=status&fileId=99`,`id=${id}&token=SECRET`])('rejects injected or incorrect query values',async query=>{expect((await GET(get(query))).status).toBe(400);expect(f.file).not.toHaveBeenCalled();});
 it('separates confirmation, cancellation and deletion into scoped actions',async()=>{
  expect((await POST(post({action:'confirm',input:{id,revision:'a'.repeat(64),confirmed:true}}))).status).toBe(200);expect(f.confirm).toHaveBeenCalledOnce();
  await POST(post({action:'cancel',input:{id}}));await POST(post({action:'delete',input:{id}}));expect(f.cancel.mock.calls.map(call=>call[4])).toEqual([false,true]);
 });
 it.each(['es','en'])('redacts failures in %s',async locale=>{f.locale=locale;f.file.mockRejectedValue(new Error('PRIVATE_SIGNED_URL'));const response=await GET(get(`id=${id}&view=file&fileId=99`));expect(response.status).toBe(503);expect(await response.text()).not.toMatch(/PRIVATE_SIGNED_URL|contacts\.migration/);});
});
