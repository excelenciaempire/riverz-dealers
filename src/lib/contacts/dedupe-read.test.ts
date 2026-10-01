import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { loadPrimaryContact } from './dedupe';
const ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333',primaryId='44444444-4444-4444-8444-444444444444';
const current={ id,workspace_id:ws,unified_contact_id:primaryId,name:'Current customer',ai_summary:'Own conversation' } as Contact;
let stored:Contact[],error:boolean,throws:boolean,bypassFilter:boolean;
const filters=vi.fn();
function database():SupabaseClient {
  return { from:() => {
    const where:Array<(row:Contact) => boolean>=[];
    const query={ select:() => query,eq:(key:'id'|'workspace_id',value:string) => { filters(key,value);where.push(row => row[key]===value);return query; },maybeSingle:async() => {
      if(throws) throw new Error('network unavailable');
      return { data:(bypassFilter?stored:stored.filter(row => where.every(test => test(row))))[0] ?? null,error:error?{ message:'private database detail' }:null };
    } };return query;
  } } as unknown as SupabaseClient;
}
beforeEach(() => { stored=[{ ...current,id:primaryId,unified_contact_id:null,name:'Verified same-business primary',ai_summary:'Own primary history' }];error=false;throws=false;bypassFilter=false; });
describe('business-scoped unified contact reads',() => {
  it('preserves the same-business primary and includes both database filters',async() => {
    expect(await loadPrimaryContact(database(),current)).toEqual(stored[0]);
    expect(filters.mock.calls).toEqual([['workspace_id',ws],['id',primaryId]]);
  });
  it('falls back to the exact current contact for a foreign primary reference',async() => {
    stored[0]={ ...stored[0],workspace_id:other,name:'Private foreign customer',ai_summary:'Private foreign history' };
    const result=await loadPrimaryContact(database(),current);
    expect(result).toBe(current);expect(JSON.stringify(result)).not.toMatch(/Private foreign/);
  });
  it.each(['workspace_id','id'])('does not accept a malformed service result with a mismatched %s',async field => {
    bypassFilter=true;stored[0]={ ...stored[0],[field]:other };
    expect(await loadPrimaryContact(database(),current)).toBe(current);
  });
  it.each(['absent','error','exception'])('preserves the current contact if the primary read is %s',async failure => {
    if(failure==='absent') stored=[];else if(failure==='error') error=true;else throws=true;
    expect(await loadPrimaryContact(database(),current)).toBe(current);
  });
  it.each([null,id])('does not read another identity for a missing or self reference %s',async pointer => {
    const contact={ ...current,unified_contact_id:pointer };
    expect(await loadPrimaryContact(database(),contact)).toBe(contact);expect(filters).not.toHaveBeenCalled();
  });
  it('does not broaden a read when the caller omitted the business',async() => {
    const contact={ ...current,workspace_id:'' };
    expect(await loadPrimaryContact(database(),contact)).toBe(contact);expect(filters).not.toHaveBeenCalled();
  });
});
