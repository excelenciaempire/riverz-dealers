import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const f=vi.hoisted(()=>({download:vi.fn()}));vi.mock('./archive-storage',()=>({downloadArchiveObject:f.download}));
import {startNativeHistoryArchive,readNativeHistoryArchive,confirmNativeHistoryArchive,cancelNativeHistoryArchive,readNativeHistoryMessages,readNativeHistoryFile} from './archive-service';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',receipt='44444444-4444-4444-8444-444444444444';
const source={provider:'chatwoot',origin:'https://source.example.test',accountId:7},hash='a'.repeat(64);
const snapshot=()=>({id,workspace_id:ws,actor_id:actor,receipt_id:receipt,source,state:'queued',created_at:'2026-10-02T00:00:00Z',expires_at:'2026-10-03T00:00:00Z',confirmed_at:null,revision:null,error:null,targets:1,contacts_collected:0,conversations:0,messages:0,files:0,next:null});
const message={sourceId:'10',conversationSourceId:'11',inboxSourceId:'3',at:'2026-10-02T00:00:00Z',kind:'note',private:true,text:'Private note',sourceFormat:'text',sourceDeleted:false,attachments:[{sourceId:'99',type:'image',bytes:3,referenceCiphertext:null}]};
const file={messageId:'10',fileId:'99',path:`${id}/${receipt}/99`,mime:'image/png',bytes:3,sha256:hash};
const page=()=>({id,workspace_id:ws,actor_id:actor,revision:hash,total:1,rows:[{message,conversation:{sourceId:'11',contactSourceId:'42',inboxSourceId:'3',at:'2026-10-02T00:00:00Z',state:'open',sourceChannel:null},target:{sourceId:'42',sourceHash:hash,contactId:receipt},files:[file]}],next:null});
const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
beforeEach(()=>{rpc.mockReset().mockResolvedValue({data:snapshot(),error:null});f.download.mockReset().mockResolvedValue({buffer:Buffer.from('abc'),mime:'image/png',fileId:'99'});});
describe('Actor-only archive review and file delivery',()=>{
 it('encrypts explicit credentials and never accepts browser replacement contacts or actor context',async()=>{
  const input={...source,id,receiptId:receipt,token:'FIXTURE_TOKEN'};await startNativeHistoryArchive(db,ws,actor,input);expect(rpc.mock.calls[0][1].p_ciphertext).not.toContain('FIXTURE_TOKEN');expect(rpc.mock.calls[0][1].p_after).toBeNull();
  await expect(startNativeHistoryArchive(db,ws,actor,{...input,rows:[]})).rejects.toThrow('invalid');expect(rpc).toHaveBeenCalledOnce();
 });
 it('refuses foreign snapshots and redacts database diagnostics',async()=>{
  rpc.mockResolvedValue({data:{...snapshot(),actor_id:receipt},error:null});await expect(readNativeHistoryArchive(db,ws,actor,{id})).rejects.toThrow('unavailable');
  rpc.mockResolvedValue({data:null,error:{message:'PRIVATE_DATABASE_DETAIL'}});await expect(readNativeHistoryArchive(db,ws,actor,{id})).rejects.toThrow(/^unavailable$/);
 });
 it('requires literal human confirmation and immutable revision, and separates confirmed deletion from cancellation',async()=>{
  await expect(confirmNativeHistoryArchive(db,ws,actor,{id,revision:hash,confirmed:false})).rejects.toThrow('invalid');expect(rpc).not.toHaveBeenCalled();
  await cancelNativeHistoryArchive(db,ws,actor,{id});expect(rpc.mock.calls[0][1].p_delete).toBe(false);await cancelNativeHistoryArchive(db,ws,actor,{id},true);expect(rpc.mock.calls[1][1].p_delete).toBe(true);
 });
 it('returns reviewed notes and file identifiers without ciphertext, paths or source hashes',async()=>{
  rpc.mockResolvedValue({data:page(),error:null});const saved=await readNativeHistoryMessages(db,ws,actor,{id});expect(saved.rows[0].message).toMatchObject({kind:'note',private:true});
  expect(saved.rows[0].files).toEqual([{fileId:'99',type:'image',mime:'image/png',bytes:3}]);expect(JSON.stringify(saved)).not.toMatch(/referenceCiphertext|sourceHash|\/99|"path"/);
 });
 it('refuses forged source joins and incorrect cursors',async()=>{
  rpc.mockResolvedValue({data:{...page(),next:1},error:null});await expect(readNativeHistoryMessages(db,ws,actor,{id})).rejects.toThrow('unavailable');
  rpc.mockResolvedValue({data:{...page(),rows:[{...page().rows[0],target:{sourceId:'43',sourceHash:hash,contactId:receipt}}]},error:null});await expect(readNativeHistoryMessages(db,ws,actor,{id})).rejects.toThrow('unavailable');
 });
 it('rechecks authority after storage and withholds bytes after a cancellation or role loss',async()=>{
  rpc.mockResolvedValue({data:file,error:null});expect((await readNativeHistoryFile(db,ws,actor,{id,fileId:'99'})).buffer.length).toBe(3);expect(rpc).toHaveBeenCalledTimes(2);
  rpc.mockResolvedValueOnce({data:file,error:null}).mockResolvedValueOnce({data:null,error:{message:'contact_migration_not_found'}});await expect(readNativeHistoryFile(db,ws,actor,{id,fileId:'99'})).rejects.toThrow('notFound');
 });
});
