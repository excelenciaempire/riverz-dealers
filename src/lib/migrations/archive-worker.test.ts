import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {initialArchiveCollection} from './archive-collection';
const f=vi.hoisted(()=>({enabled:true,conversations:vi.fn(),messages:vi.fn(),open:vi.fn(),openFile:vi.fn(),sealFile:vi.fn(),download:vi.fn(),upload:vi.fn(),remove:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('./archive-credentials',()=>({openArchiveCredential:f.open,openArchiveFileReference:f.openFile,sealArchiveFileReference:f.sealFile}));
vi.mock('./providers/chatwoot-history-client',()=>({readChatwootContactConversations:f.conversations,readChatwootHistoryMessages:f.messages}));
vi.mock('./archive-download',()=>({downloadArchiveFile:f.download}));
vi.mock('./archive-storage',()=>({uploadArchiveObject:f.upload,removeArchiveObjects:f.remove}));
import {syncNativeHistoryArchives,purgeNativeHistoryStorage} from './archive-worker';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444',receipt='55555555-5555-4555-8555-555555555555';
const source={provider:'chatwoot',origin:'https://source.example.test',accountId:7};
const target={sourceId:'42',sourceHash:'a'.repeat(64),contactId:receipt},cipher='a'.repeat(24)+':deadbeef:'+ 'b'.repeat(32);
const job=()=>({id,workspace_id:ws,actor_id:actor,receipt_id:receipt,source,credential_ciphertext:'ENCRYPTED_FIXTURE',lease_id:lease,step:0,payload:initialArchiveCollection([target]),expires_at:new Date(Date.now()+600000).toISOString()});
const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
const filesJob=()=>({...job(),credential_ciphertext:null,payload:{...initialArchiveCollection([target]),phase:'files',targetIndex:1,conversationIndex:1,
 conversations:[{sourceId:'11',contactSourceId:'42',inboxSourceId:'3',state:'open',at:'2026-10-02T00:00:00Z',sourceChannel:null}],messages:[{sourceId:'10',conversationSourceId:'11',inboxSourceId:'3',at:'2026-10-02T00:00:00Z',kind:'note',private:true,text:'Fixture',sourceFormat:'text',sourceDeleted:false,attachments:[{sourceId:'99',type:'image',bytes:3,referenceCiphertext:cipher}]}]}});
function queue(value:unknown=job()){
 let claimed=false;rpc.mockImplementation(async(name:string)=>({error:null,data:name==='claim_native_history_archives'?claimed?[]:(claimed=true,[value]):name==='register_native_history_object'?`${id}/${lease}/99`:true}));
}
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.open.mockReturnValue('FIXTURE_TOKEN');f.openFile.mockReturnValue('https://files.example.test/signed?key=SECRET');f.sealFile.mockReturnValue(cipher);
 f.conversations.mockResolvedValue({conversations:[],initialSample:true,previous:null,next:null});f.download.mockResolvedValue({buffer:Buffer.from('abc'),mime:'image/png'});f.upload.mockResolvedValue(undefined);f.remove.mockResolvedValue(undefined);queue();});
describe('Bounded private history worker',()=>{
 it('does no work in the public stage',async()=>{f.enabled=false;expect(await syncNativeHistoryArchives(db)).toEqual({steps:0,failed:0,skipped:0});expect(rpc).not.toHaveBeenCalled();expect(f.open).not.toHaveBeenCalled();});
 it('checks fresh authority before decryption and each single source read',async()=>{
  expect(await syncNativeHistoryArchives(db)).toEqual({steps:1,failed:0,skipped:0});expect(rpc.mock.calls.map(row=>row[0])).toEqual(['claim_native_history_archives','authorize_native_history_step','authorize_native_history_step','record_native_history_step','claim_native_history_archives']);
  expect(f.conversations).toHaveBeenCalledExactlyOnceWith(source,'FIXTURE_TOKEN',{contactId:42});expect(f.messages).not.toHaveBeenCalled();expect(JSON.stringify(rpc.mock.calls)).not.toContain('FIXTURE_TOKEN');
 });
 it('downloads and privately stages one file with a registered lease path and encrypted reference erased',async()=>{
  queue(filesJob());expect((await syncNativeHistoryArchives(db)).steps).toBe(1);expect(f.open).not.toHaveBeenCalled();expect(f.download).toHaveBeenCalledExactlyOnceWith('https://files.example.test/signed?key=SECRET',3,8388608);
  expect(f.upload).toHaveBeenCalledExactlyOnceWith(`${id}/${lease}/99`,Buffer.from('abc'),'image/png');
  const saved=rpc.mock.calls.find(row=>row[0]==='record_native_history_step')![1].p_payload;expect(saved).toMatchObject({phase:'done',messages:[{attachments:[{referenceCiphertext:null}]}],storedFiles:[{bytes:3,mime:'image/png'}]});expect(JSON.stringify(saved)).not.toContain('SECRET');
 });
 it('does not upload after revocation during the source file read',async()=>{
  queue(filesJob());f.download.mockImplementation(async()=>{rpc.mockImplementation(async(name:string)=>({error:name==='authorize_native_history_step'?{message:'contact_migration_not_found'}:null,data:name==='claim_native_history_archives'?[]:true}));return {buffer:Buffer.from('abc'),mime:'image/png'};});
  expect((await syncNativeHistoryArchives(db)).failed).toBe(1);expect(f.upload).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it('keeps lost uploads registered for cleanup without guessing that the write failed',async()=>{
  queue(filesJob());f.upload.mockRejectedValue(new Error('PRIVATE_SIGNED_URL'));expect((await syncNativeHistoryArchives(db)).failed).toBe(1);expect(f.remove).not.toHaveBeenCalled();expect(rpc.mock.calls.some(row=>row[0]==='record_native_history_step')).toBe(false);expect(JSON.stringify(rpc.mock.calls)).not.toContain('PRIVATE_SIGNED_URL');
 });
 it('rejects malformed claims before credentials or network activity',async()=>{
  queue({...job(),actor_id:'bad'});await expect(syncNativeHistoryArchives(db)).rejects.toThrow('native_history_worker_unavailable');expect(f.conversations).not.toHaveBeenCalled();expect(f.open).not.toHaveBeenCalled();
 });
 it('bounds continuous queues to eight rounds and redacts failure recording errors',async()=>{
  rpc.mockImplementation(async(name:string)=>({error:null,data:name==='claim_native_history_archives'?[job()]:true}));expect((await syncNativeHistoryArchives(db)).steps).toBe(8);
  queue();f.open.mockImplementation(()=>{throw new Error('source_credential_unavailable');});rpc.mockResolvedValueOnce({error:null,data:[job()]}).mockResolvedValueOnce({error:null,data:true}).mockResolvedValueOnce({error:{message:'SECRET'},data:null});await expect(syncNativeHistoryArchives(db)).rejects.toThrow('native_history_worker_unavailable');
 });
 it('cleans only registered old orphan paths and forgets metadata after successful storage removal',async()=>{
  rpc.mockImplementation(async(name:string)=>({error:null,data:name==='list_native_history_orphans'?[{path:`${id}/${lease}/99`}]:true}));expect(await purgeNativeHistoryStorage(db)).toBe(1);expect(f.remove).toHaveBeenCalledExactlyOnceWith([`${id}/${lease}/99`]);
  f.remove.mockRejectedValue(new Error('SECRET'));rpc.mockClear();await expect(purgeNativeHistoryStorage(db)).rejects.toThrow('native_history_cleanup_unavailable');expect(rpc).toHaveBeenCalledOnce();
 });
});
