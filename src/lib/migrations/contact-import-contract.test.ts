import {describe,it,expect} from 'vitest';
import {contactMigrationPreparation,contactMigrationConfirmation,contactMigrationSnapshot,type ContactMigrationSnapshot} from './contact-import-contract';
const id='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',revision='a'.repeat(64);
const base=():ContactMigrationSnapshot=>({id,workspace_id:workspace,actor_id:actor,provider:'chatwoot',account:'Synthetic source',revision,state:'prepared',prepared_at:'2026-10-02T05:00:00Z',expires_at:'2026-10-02T05:30:00Z',completed_at:null,
  counts:{total:1,new:1,existing:0,excluded:0,created:0},rows:[{row:2,sourceId:'source-1',phone:'+12025550101',name:'Synthetic',email:'',company:'',state:'new',issues:[],contact_id:null}],next:null});
describe('Durable contact migration boundary',()=>{
  it('requires an explicit hash-bound confirmation, never treats a preview as approval',()=>{
    expect(contactMigrationConfirmation.safeParse({id,revision,confirmed:true}).success).toBe(true);
    for(const value of [{id,revision,confirmed:false},{id,revision},{id,confirmed:true},{id,revision,confirmed:true,workspace_id:workspace}])expect(contactMigrationConfirmation.safeParse(value).success).toBe(false);
  });
  it('accepts only a bounded named source, rejects actor/account scope injected in the file request',()=>{
    const input={id,provider:'chatwoot',account:'Synthetic source',csv:'id,phone\na,+12025550101',mapping:{sourceId:0,phone:1,name:-1,email:-1,company:-1}};
    expect(contactMigrationPreparation.safeParse(input).success).toBe(true);
    for(const extra of [{workspace_id:workspace},{actor_id:actor},{account:'source\nother'},{provider:'unknown'}])expect(contactMigrationPreparation.safeParse({...input,...extra}).success).toBe(false);
  });
  it('accepts the prepared snapshot with explicit totals',()=>expect(contactMigrationSnapshot.safeParse(base()).success).toBe(true));
  it('rejects successful-looking partial totals',()=>{const value=base();value.counts.total=2;expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);});
  it('rejects created contacts before confirmation',()=>{const value=base();value.counts.created=1;expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);});
  it('rejects a complete receipt without matching count and timestamp',()=>{const value=base();value.state='completed';expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);});
  it('rejects duplicate or backwards row cursors',()=>{
    const value=base();value.rows.push({...value.rows[0]});expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);
    value.rows=[{...value.rows[0],row:3},{...value.rows[0],row:2}];expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);
  });
  it('rejects a cursor that would silently skip or repeat observed rows',()=>{const value=base();value.next=3;expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);});
  it('expired jobs cannot expose their payload again',()=>{const value=base();value.state='expired';expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);value.rows=[];expect(contactMigrationSnapshot.safeParse(value).success).toBe(true);});
  it('does not accept a row as new when it is linked to an existing identity or carries errors',()=>{
    const value=base();Object.assign(value.rows[0],{contact_id:id});expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);
    Object.assign(value.rows[0],{contact_id:null,issues:['phone_conflict']});expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);
  });
  it('does not accept new rows without a source identity and canonical international phone',()=>{
    const value=base();value.rows[0].sourceId=' ';expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);
    value.rows[0].sourceId='source-1';value.rows[0].phone='2025550101';expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);
  });
  it('does not expose expired or completed raw file rows',()=>{
    const value=base();value.state='completed';value.completed_at='2026-10-02T05:10:00Z';value.counts.created=1;
    expect(contactMigrationSnapshot.safeParse(value).success).toBe(false);value.rows=[];expect(contactMigrationSnapshot.safeParse(value).success).toBe(true);
  });
});
