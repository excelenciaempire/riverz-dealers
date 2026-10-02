import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const f=vi.hoisted(()=>({prepare:vi.fn()}));
vi.mock('./contact-import',async original=>({...await original<typeof import('./contact-import')>(),prepareContactMigration:f.prepare}));
import {startExternalContactSource,readExternalContactSource,cancelExternalContactSource,prepareExternalContactReview} from './external-contact-source';
import {readMigrationCsv} from './contact-preview';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',reviewId='44444444-4444-4444-8444-444444444444';
const source={provider:'kommo',origin:'https://fixture.kommo.com',accountId:7},input={source,id,token:'FIXTURE_TOKEN'};
const snapshot=()=>({id,workspace_id:ws,actor_id:actor,source,state:'queued',total:null,collected:0,created_at:'2026-10-02T06:00:00Z',expires_at:'2026-10-02T08:00:00Z',updated_at:'2026-10-02T06:00:00Z',error:null,rows:[],next:null});
const row={sourceId:'1',phone:'+573001112233',name:'Person,"\n💬',email:'person@example.test',company:'=literal'};
const payload=()=>({id,workspace_id:ws,actor_id:actor,source,total:1,rows:[row]});
const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
beforeEach(()=>{rpc.mockReset().mockResolvedValue({data:snapshot(),error:null});f.prepare.mockReset().mockResolvedValue({fixture:true});});
describe('Native source review service',()=>{
 it('stores only encrypted bound credentials with a stable keyed retry fingerprint',async()=>{
  expect(await startExternalContactSource(db,ws,actor,input)).toEqual(snapshot());const first=rpc.mock.calls[0][1];expect(first.p_ciphertext).not.toContain('FIXTURE_TOKEN');expect(first.p_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await startExternalContactSource(db,ws,actor,input);expect(rpc.mock.calls[1][1].p_fingerprint).toBe(first.p_fingerprint);expect(rpc.mock.calls[1][1].p_ciphertext).not.toBe(first.p_ciphertext);
 });
 it.each([{...input,workspace_id:ws},{...input,actor_id:actor},{...input,origin:'https://127.0.0.1'},{...input,token:'x\n'}])('rejects forged authority or unsafe source before RPC',async value=>{
  await expect(startExternalContactSource(db,ws,actor,value)).rejects.toThrow('invalid');expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['id','workspace_id','actor_id','source'] as const)('rejects foreign %s in a source receipt',async field=>{
  rpc.mockResolvedValue({data:{...snapshot(),[field]:field==='source'?{...source,accountId:8}:reviewId},error:null});await expect(startExternalContactSource(db,ws,actor,input)).rejects.toThrow('unavailable');
 });
 it('rejects missing ready sample rows and an incorrect cursor',async()=>{
  rpc.mockResolvedValue({data:{...snapshot(),state:'ready',total:1,collected:1},error:null});await expect(readExternalContactSource(db,ws,actor,{id})).rejects.toThrow('unavailable');
  rpc.mockResolvedValue({data:{...snapshot(),state:'ready',total:26,collected:26,rows:Array.from({length:25},(_,i)=>({...row,sourceId:String(i+1)})),next:24},error:null});await expect(readExternalContactSource(db,ws,actor,{id})).rejects.toThrow('unavailable');
 });
 it('cancels through current actor and workspace rather than trusting body scope',async()=>{
  rpc.mockResolvedValue({data:{...snapshot(),state:'cancelled'},error:null});expect((await cancelExternalContactSource(db,ws,actor,{id})).state).toBe('cancelled');expect(rpc.mock.calls[0][1]).toEqual({p_workspace_id:ws,p_actor_id:actor,p_id:id});
 });
 it('uses service-fetched data and keeps a new separate human review with exact literal Unicode and CSV quoting',async()=>{
  rpc.mockResolvedValue({data:payload(),error:null});await prepareExternalContactReview(db,ws,actor,{id,reviewId});const preparation=f.prepare.mock.calls[0][3];
  expect(preparation).toMatchObject({id:reviewId,provider:'kommo',account:'https://fixture.kommo.com#7',mapping:{sourceId:0,phone:1,name:2,email:3,company:4}});
  expect(readMigrationCsv(preparation.csv).rows).toEqual([Object.values(row)]);expect(f.prepare.mock.calls[0].slice(0,3)).toEqual([db,ws,actor]);
  expect(f.prepare.mock.calls[0][4]).toBe(id);expect(f.prepare.mock.calls[0][5]).toBe('external');
 });
 it.each([{id,reviewId,rows:[row]},{id,reviewId:id},{id,reviewId,confirmed:true}])('rejects browser replacement rows or implicit import',async value=>{
  await expect(prepareExternalContactReview(db,ws,actor,value)).rejects.toThrow('invalid');expect(rpc).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each([{...payload(),actor_id:reviewId},{...payload(),total:2},{...payload(),rows:[{...row,access_token:'SECRET'}]}, {...payload(),total:2,rows:[row,row]}])('fails closed on a foreign or malformed private payload',async data=>{
  rpc.mockResolvedValue({data,error:null});await expect(prepareExternalContactReview(db,ws,actor,{id,reviewId})).rejects.toThrow('unavailable');expect(f.prepare).not.toHaveBeenCalled();
 });
 it('maps known private errors and redacts unknown database diagnostics',async()=>{
  for(const [message,expected] of [['external_contact_migration_changed','changed'],['contact_migration_not_found','notFound'],['contact_migration_read_only','readOnly'],['PRIVATE_DB_SECRET','unavailable']]){
   rpc.mockResolvedValue({data:null,error:{message}});await expect(readExternalContactSource(db,ws,actor,{id})).rejects.toThrow(expected);
  }
 });
});
