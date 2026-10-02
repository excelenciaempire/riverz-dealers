import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const f=vi.hoisted(()=>({enabled:true,read:vi.fn(),open:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('./native-credentials',()=>({openNativeCredential:f.open}));
vi.mock('./providers/chatwoot-client',async original=>({...await original<typeof import('./providers/chatwoot-client')>(),readChatwootContactPage:f.read}));
import {NativeSourceError} from './providers/chatwoot-client';
import {syncNativeContactSources} from './native-contact-worker';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444';
const source={provider:'chatwoot',origin:'https://source.example.test',accountId:7};
const job=()=>({id,workspace_id:ws,actor_id:actor,source,credential_ciphertext:'ENCRYPTED_FIXTURE',lease_id:lease,page:1,total:null,collected:0,expires_at:new Date(Date.now()+600000).toISOString()});
const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
const page={page:1,total:1,next:null,contacts:[{sourceId:'1',phone:'+573001112233',name:'Fixture',email:'',company:''}]};
beforeEach(()=>{
 f.enabled=true;f.open.mockReset().mockReturnValue('FIXTURE_TOKEN');f.read.mockReset().mockResolvedValue(page);let claims=0;
 rpc.mockReset().mockImplementation(async(name:string)=>({data:name==='claim_native_contact_migrations'?(claims++===0?[job()]:[]):true,error:null}));
});
describe('Bounded private native contact worker',()=>{
 it('does nothing with the production feature disabled',async()=>{f.enabled=false;expect(await syncNativeContactSources(db)).toEqual({pages:0,failed:0,skipped:0});expect(rpc).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();});
 it('checks current authority before decryption and provider IO and stores only projected rows',async()=>{
  expect(await syncNativeContactSources(db)).toEqual({pages:1,failed:0,skipped:0});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['claim_native_contact_migrations','authorize_native_contact_page','record_native_contact_page','claim_native_contact_migrations']);
  expect(f.open).toHaveBeenCalledExactlyOnceWith({workspaceId:ws,actorId:actor,jobId:id,source},'ENCRYPTED_FIXTURE');
  expect(f.read).toHaveBeenCalledExactlyOnceWith(source,'FIXTURE_TOKEN',{page:1});expect(rpc.mock.calls[2][1]).toEqual({p_id:id,p_lease_id:lease,p_page:1,p_total:1,p_rows:page.contacts});
  expect(JSON.stringify(rpc.mock.calls)).not.toContain('FIXTURE_TOKEN');
 });
 it('limits a continuous queue to eight bounded batches without implicit provider retries',async()=>{
  rpc.mockImplementation(async(name:string)=>({data:name==='claim_native_contact_migrations'?[job()]:true,error:null}));
  expect((await syncNativeContactSources(db)).pages).toBe(8);expect(f.read).toHaveBeenCalledTimes(8);
 });
 it.each([null,{...job(),workspace_id:'bad'}, {...job(),page:2,collected:0}, {...job(),token:'INJECTED'}])('refuses malformed claims before credentials or outbound IO',async value=>{
  rpc.mockResolvedValue({data:[value],error:null});await expect(syncNativeContactSources(db)).rejects.toThrow('native_contact_worker_unavailable');expect(f.open).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it('skips expired or invalidated leases without fetching',async()=>{
  rpc.mockResolvedValueOnce({data:[{...job(),expires_at:new Date(Date.now()-1000).toISOString()}],error:null}).mockResolvedValueOnce({data:[],error:null});
  expect((await syncNativeContactSources(db)).skipped).toBe(1);expect(f.read).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({data:[job()],error:null}).mockResolvedValueOnce({data:false,error:null}).mockResolvedValueOnce({data:[],error:null});
  expect((await syncNativeContactSources(db)).skipped).toBe(1);expect(f.open).not.toHaveBeenCalled();
 });
 it.each(['contact_migration_not_found','contact_migration_read_only'])('clears a credential when current authority fails with %s',async message=>{
  rpc.mockResolvedValueOnce({data:[job()],error:null}).mockResolvedValueOnce({data:null,error:{message}}).mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:[],error:null});
  expect((await syncNativeContactSources(db)).failed).toBe(1);expect(f.read).not.toHaveBeenCalled();expect(f.open).not.toHaveBeenCalled();
  expect(rpc.mock.calls[2][1].p_code).toBe(message==='contact_migration_not_found'?'source_access_revoked':'source_read_only');
 });
 it.each(['source_auth','source_rate_limit','source_timeout','source_changed'] as const)('persists sanitized %s and lets SQL choose any retry',async code=>{
  f.read.mockRejectedValue(new NativeSourceError(code));expect((await syncNativeContactSources(db)).failed).toBe(1);expect(rpc.mock.calls[2]).toEqual(['fail_native_contact_migration',{p_id:id,p_lease_id:lease,p_code:code}]);
 });
 it('does not fetch with a corrupt credential and never persists raw exception details',async()=>{
  f.open.mockImplementation(()=>{throw new Error('source_credential_unavailable');});expect((await syncNativeContactSources(db)).failed).toBe(1);expect(f.read).not.toHaveBeenCalled();expect(rpc.mock.calls[2][1].p_code).toBe('source_credential_unavailable');
  f.open.mockReturnValue('FIXTURE_TOKEN');f.read.mockRejectedValue(new Error('PRIVATE_SOURCE_SECRET'));await syncNativeContactSources(db);expect(JSON.stringify(rpc.mock.calls)).not.toContain('PRIVATE_SOURCE_SECRET');
 });
 it('ignores a stale result and fails visibly if safe failure recording is unavailable',async()=>{
  rpc.mockResolvedValueOnce({data:[job()],error:null}).mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:false,error:null}).mockResolvedValueOnce({data:[],error:null});
  expect((await syncNativeContactSources(db)).skipped).toBe(1);
  rpc.mockResolvedValueOnce({data:[job()],error:null}).mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:null,error:{message:'PRIVATE_ERROR'}}).mockResolvedValueOnce({data:null,error:{message:'PRIVATE_ERROR'}});
  await expect(syncNativeContactSources(db)).rejects.toThrow('native_contact_worker_unavailable');
 });
});
