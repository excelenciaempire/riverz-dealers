import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { linkUnifiedContact,loadPrimaryContact } from './dedupe';
const ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333',primaryId='44444444-4444-4444-8444-444444444444';
const current={id,workspace_id:ws,unified_contact_id:primaryId,name:'Current customer',ai_summary:'Own conversation'} as Contact;
const rpc=vi.fn(),from=vi.fn();
const database={rpc,from} as unknown as SupabaseClient;
const stored={...current,id:primaryId,unified_contact_id:null,union_bloqueada:false,name:'Same-business primary',ai_summary:'Own primary history'};
beforeEach(()=>{vi.clearAllMocks();rpc.mockResolvedValue({data:stored,error:null});});
describe('Database-verified unified contact reads',()=>{
  it('uses one server-scoped identity snapshot rather than a supplied pointer',async()=>{
    expect(await loadPrimaryContact(database,current)).toEqual(stored);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_verified_primary_contact',{p_workspace_id:ws,p_contact_id:id});expect(from).not.toHaveBeenCalled();
  });
  it.each(['workspace_id','id','unified_contact_id','union_bloqueada'])('refuses a malformed or unsafe %s result',async field=>{
    rpc.mockResolvedValue({data:{...stored,[field]:field==='union_bloqueada'?true:field==='id'?id:other},error:null});
    expect(await loadPrimaryContact(database,current)).toBe(current);
  });
  it.each(['absent','error','exception'])('preserves the current identity after %s',async failure=>{
    if(failure==='exception')rpc.mockRejectedValue(new Error('private detail'));
    else rpc.mockResolvedValue({data:failure==='absent'?null:stored,error:failure==='error'?{message:'private detail'}:null});
    expect(await loadPrimaryContact(database,current)).toBe(current);
  });
  it.each(['id','workspace_id'])('does not broaden an invalid %s scope',async field=>{
    const contact={...current,[field]:''};expect(await loadPrimaryContact(database,contact)).toBe(contact);expect(rpc).not.toHaveBeenCalled();
  });
  it('can observe a newly linked persisted contact without trusting a stale client pointer',async()=>{
    expect(await loadPrimaryContact(database,{...current,unified_contact_id:null})).toEqual(stored);
  });
});
describe('Transactional contact linking',()=>{
  it('supplies only identity keys, never forged phone, email, origin or candidates',async()=>{
    rpc.mockResolvedValue({data:primaryId,error:null});expect(await linkUnifiedContact(database,{...current,phone:'+0000000000',email:'forged@example.com'})).toBe(primaryId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('link_verified_contact',{p_workspace_id:ws,p_contact_id:id});expect(from).not.toHaveBeenCalled();
  });
  it.each(['refusal','invalid','exception'])('keeps ingest isolated after %s without an unaudited fallback write',async kind=>{
    if(kind==='exception')rpc.mockRejectedValue(new Error('private detail'));
    else rpc.mockResolvedValue({data:kind==='invalid'?'not-an-id':primaryId,error:kind==='refusal'?{message:'private detail'}:null});
    expect(await linkUnifiedContact(database,current)).toBe(id);expect(from).not.toHaveBeenCalled();
  });
});
