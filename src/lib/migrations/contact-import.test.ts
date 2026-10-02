import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {prepareContactMigration,confirmContactMigration,readContactMigration,readContactMigrationResults} from './contact-import';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',revision='a'.repeat(64);
const input={id,provider:'chatwoot',account:'Fixture',csv:'id,phone,name\na,+573001112233,Test',mapping:{sourceId:0,phone:1,name:2,email:-1,company:-1}};
const review=()=>({id,workspace_id:ws,actor_id:actor,provider:'chatwoot',account:'Fixture',revision,state:'prepared',prepared_at:'2026-10-02T05:00:00Z',expires_at:'2026-10-02T05:30:00Z',completed_at:null,
 counts:{total:1,new:1,existing:0,excluded:0,created:0},rows:[{row:2,sourceId:'a',phone:'+573001112233',name:'Test',email:'',company:'',state:'new',issues:[],contact_id:null}],next:null});
const rpc=vi.fn(),db={rpc} as unknown as SupabaseClient;
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:review(),error:null});});
describe('Contact import service derives and validates authority',()=>{
 it('reanalyzes the CSV and binds immutable retries to source, mapping and exact bytes',async()=>{
  await prepareContactMigration(db,ws,actor,input);const args=rpc.mock.calls[0][1];
  expect(args).toMatchObject({p_workspace_id:ws,p_actor_id:actor,p_id:id,p_rows:[{row:2,sourceId:'a',phone:'+573001112233',issues:[]}]});expect(args.p_input_hash).toMatch(/^[a-f0-9]{64}$/);
  await prepareContactMigration(db,ws,actor,{...input,mapping:{...input.mapping}});expect(rpc.mock.calls[1][1].p_input_hash).toBe(args.p_input_hash);
  await prepareContactMigration(db,ws,actor,{...input,csv:input.csv+'\n'});expect(rpc.mock.calls[2][1].p_input_hash).not.toBe(args.p_input_hash);
 });
 it.each([{...input,workspace_id:ws},{...input,actor_id:actor},{...input,csv:'id,phone\na,"broken'},{...input,csv:'a,b\n1,2,3'},
  {...input,mapping:{...input.mapping,sourceId:-1}},{...input,csv:'💬'.repeat(600000)}])('rejects forged authority, malformed parsing or excess actual UTF-8 bytes',async value=>{
  await expect(prepareContactMigration(db,ws,actor,value)).rejects.toThrow('invalid');expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['workspace_id','actor_id','id','account','provider'] as const)('rejects a provider response with mismatched %s',async field=>{
  rpc.mockResolvedValue({data:{...review(),[field]:field==='account'?'Other':field==='provider'?'kommo':'44444444-4444-4444-8444-444444444444'},error:null});
  await expect(prepareContactMigration(db,ws,actor,input)).rejects.toThrow('unavailable');
 });
 it('requires explicit approval and a completed matching receipt',async()=>{
  await expect(confirmContactMigration(db,ws,actor,{id,revision,confirmed:false})).rejects.toThrow('invalid');expect(rpc).not.toHaveBeenCalled();
  await expect(confirmContactMigration(db,ws,actor,{id,revision,confirmed:true})).rejects.toThrow('unavailable');
  const completed={...review(),state:'completed',completed_at:'2026-10-02T05:10:00Z',rows:[],counts:{...review().counts,created:1}};
  rpc.mockResolvedValue({data:completed,error:null});expect(await confirmContactMigration(db,ws,actor,{id,revision,confirmed:true})).toEqual(completed);
 });
 it.each(['invalid','not_found','changed','expired','read_only','limit'] as const)('maps private SQL %s without disclosing database details',async suffix=>{
  rpc.mockResolvedValue({data:null,error:{message:suffix==='invalid'?'invalid_contact_migration':'contact_migration_'+suffix}});
  await expect(prepareContactMigration(db,ws,actor,input)).rejects.toThrow({not_found:'notFound',read_only:'readOnly'}[suffix as 'not_found'|'read_only']??suffix);
 });
 it('fails closed on malformed output, empty or skipped pages and foreign report scopes',async()=>{
  rpc.mockResolvedValue({data:{...review(),counts:{...review().counts,total:2}},error:null});await expect(readContactMigration(db,ws,actor,{id})).rejects.toThrow('unavailable');
  rpc.mockResolvedValue({data:{...review(),rows:[]},error:null});await expect(readContactMigration(db,ws,actor,{id})).rejects.toThrow('unavailable');
  rpc.mockResolvedValue({data:{id,workspace_id:ws,actor_id:actor,revision,total:1,rows:[{row:2,sourceId:'a',state:'created',issues:[],contact_id:id}],next:null},error:null});
  expect(await readContactMigrationResults(db,ws,actor,{id})).toMatchObject({total:1});
  await expect(readContactMigrationResults(db,ws,'44444444-4444-4444-8444-444444444444',{id})).rejects.toThrow('unavailable');
 });
});
