import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {externalSourceSnapshot} from './external-source-contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555';
const source={provider:'gorgias',origin:'https://fixture.gorgias.com'},fingerprint='a'.repeat(64),cipher='a'.repeat(24)+':deadbeef:'+ 'b'.repeat(32);
const row=(n=1)=>({sourceId:String(n),phone:'+573001112233',name:'Fixture',email:'person@example.test',company:''});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const create=(job=id,actor=owner,definition:unknown=source,hash=fingerprint)=>scalar('SELECT create_external_contact_migration($1,$2,$3,$4,$5,$6)',[ws,actor,job,JSON.stringify(definition),hash,cipher]);
const read=(job=id,actor=owner,after=0)=>scalar('SELECT read_external_contact_migration($1,$2,$3,$4)',[ws,actor,job,after]);
const claim=async()=>await scalar('SELECT claim_external_contact_migrations(2)') as Array<{id:string;lease_id:string;page:number;credential_ciphertext:string}>;
const record=(lease:string,page=1,done=true,rows:unknown[]=[row()],cursor:string|null=null,next:string|null=null)=>scalar('SELECT record_external_cursor_contact_page($1,$2,$3,$4,$5,$6,$7)',[id,lease,page,done,JSON.stringify(rows),cursor,next]);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE workspace_subscriptions(workspace_id uuid);CREATE TABLE workspace_billing_invoices(workspace_id uuid);
 CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id),channel text,external_id text,wa_id text,phone text,name text,email text,company text,
 phone_origen text,email_origen text,union_bloqueada boolean DEFAULT false,opted_out boolean DEFAULT false,opted_out_at timestamptz,opted_out_reason text,UNIQUE(workspace_id,id));
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/360_contact_migration_receipts.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/367_external_contact_migrations.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/368_external_cursor_contact_migrations.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE contacts,workspace_members,workspace_subscriptions,workspace_billing_invoices,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2),($3)',[owner,admin,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin','[\"/contactos\"]')",[ws,admin]);
});
describe('Private cursor collection and independent SQL invariants',()=>{
 it('keeps the new schema probe and RPC private',async()=>{
  expect(await scalar('SELECT external_cursor_contact_review_ready()')).toBe(true);
  for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await expect(scalar('SELECT external_cursor_contact_review_ready()')).rejects.toThrow('permission denied');await expect(record(id)).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
 });
 it.each(['gorgias','zendesk'])('accepts exact %s origins without invented account IDs',async provider=>{
  const definition={provider,origin:`https://fixture.${provider}.com`};expect(externalSourceSnapshot.parse(await create(id,owner,definition)).source).toEqual(definition);
 });
 it.each([{...source,accountId:7},{...source,origin:'https://fixture.gorgias.com.evil.test'},{provider:'zendesk',origin:'https://fixture.gorgias.com'},{...source,origin:'https://fixture.gorgias.com/api/customers'},{...source,origin:null}])('rejects extra keys and wrong account scope',async definition=>{
  await expect(create(id,owner,definition)).rejects.toThrow('invalid_external_contact_migration');
 });
 it('keeps unknown total on short nonterminal pages and hides cursor metadata from browser snapshots',async()=>{
  await create();let [lease]=await claim();expect(lease).toMatchObject({source_cursor:null});await record(lease.lease_id,1,false,[row()],null,'NEXT_1==');
  const saved=externalSourceSnapshot.parse(await read());expect(saved).toMatchObject({state:'queued',total:null,collected:1,rows:[]});expect(JSON.stringify(saved)).not.toContain('NEXT_1');
  await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();expect(lease).toMatchObject({page:2,source_cursor:'NEXT_1=='});
  await record(lease.lease_id,2,true,[row(2)],'NEXT_1==');expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'ready',total:2,collected:2});
  expect(await scalar('SELECT source_cursor FROM external_contact_migration_jobs')).toBeNull();expect(await scalar('SELECT cardinality(cursor_hashes) FROM external_contact_migration_jobs')).toBe(0);
 });
 it('rejects replayed request cursors, terminal disagreement and a duplicate row without advancing',async()=>{
  await create();const [lease]=await claim();for(const args of [()=>record(lease.lease_id,1,false,[row()],null,null),()=>record(lease.lease_id,1,false,[row()],null,'https://evil.test'),()=>record(lease.lease_id,1,false,[],null,'A'),()=>record(lease.lease_id,1,false,[row(),row()],null,'A')])await expect(args()).rejects.toThrow();
  expect(await scalar('SELECT collected FROM external_contact_migration_jobs')).toBe(0);
 });
 it('rejects cursor cycles across three pages rather than claiming a partial ready job',async()=>{
  await create();let [lease]=await claim();await record(lease.lease_id,1,false,[row()],null,'A');await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();
  await expect(record(lease.lease_id,2,false,[row(2)],'WRONG','B')).rejects.toThrow('external_contact_migration_changed');await record(lease.lease_id,2,false,[row(2)],'A','B');
  await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();await expect(record(lease.lease_id,3,false,[row(3)],'B','A')).rejects.toThrow('external_contact_migration_changed');expect(await scalar('SELECT total FROM external_contact_migration_jobs')).toBeNull();
 });
 it('accepts a documented empty boundary and a genuine empty account',async()=>{
  await create();let [lease]=await claim();await record(lease.lease_id,1,false,[row()],null,'A');await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();await record(lease.lease_id,2,true,[],'A');expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'ready',total:1});
  await db.exec('TRUNCATE external_contact_migration_jobs');await create();[lease]=await claim();await record(lease.lease_id,1,true,[]);expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'empty',total:0});
 });
 it('clears opaque cursors on cancellation and rejects stale lease responses',async()=>{
  await create();let [lease]=await claim();await record(lease.lease_id,1,false,[row()],null,'A');await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();await scalar('SELECT cancel_external_contact_migration($1,$2,$3)',[ws,owner,id]);
  expect(await record(lease.lease_id,2,true,[row(2)],'A')).toBe(false);expect(await scalar('SELECT source_cursor FROM external_contact_migration_jobs')).toBeNull();expect(await scalar('SELECT cardinality(cursor_hashes) FROM external_contact_migration_jobs')).toBe(0);
 });
 it('prepares the exact provider origin in a locked human review without importing',async()=>{
  await create();const [lease]=await claim();await record(lease.lease_id);const review='66666666-6666-4666-8666-666666666666';
  expect(await scalar('SELECT prepare_external_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify([{...row(),row:2,issues:[]}])])).toMatchObject({state:'prepared',provider:'gorgias',account:source.origin});expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it('cannot use the cursor RPC for an existing Kommo job or the legacy RPC for a cursor job',async()=>{
  await create();let [lease]=await claim();await expect(scalar('SELECT record_external_contact_page($1,$2,1,true,$3)',[id,lease.lease_id,JSON.stringify([row()])])).rejects.toThrow('external_contact_migration_changed');await db.exec('TRUNCATE external_contact_migration_jobs');
  await create(id,owner,{provider:'kommo',origin:'https://fixture.kommo.com',accountId:7});[lease]=await claim();await expect(record(lease.lease_id)).rejects.toThrow('external_contact_migration_changed');
 });
 it('never returns a partial ready result at the contact or page budget',async()=>{
  await create();const rows=Array.from({length:5000},(_,i)=>row(i+1));await db.query("UPDATE external_contact_migration_jobs SET payload=$1,collected=5000,page=201,source_cursor='A'",[JSON.stringify(rows)]);const [lease]=await claim();
  await expect(record(lease.lease_id,201,true,[row(5001)],'A')).rejects.toThrow('external_contact_migration_limit');await expect(record(lease.lease_id,201,false,[row(5001)],'A','B')).rejects.toThrow('external_contact_migration_limit');
  expect(await scalar('SELECT total FROM external_contact_migration_jobs')).toBeNull();await record(lease.lease_id,201,true,[],'A');expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'ready',total:5000});
 });
 it('clears cursors on expiry and terminal failure without retaining source credentials',async()=>{
  await create();let [lease]=await claim();await record(lease.lease_id,1,false,[row()],null,'A');await db.exec("UPDATE external_contact_migration_jobs SET expires_at=clock_timestamp()-interval '1 second'");await scalar('SELECT purge_external_contact_migrations()');
  expect(await scalar('SELECT source_cursor FROM external_contact_migration_jobs')).toBeNull();expect(await scalar('SELECT credential_ciphertext FROM external_contact_migration_jobs')).toBeNull();
  await db.exec('TRUNCATE external_contact_migration_jobs');await create();[lease]=await claim();await record(lease.lease_id,1,false,[row()],null,'A');await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();await scalar('SELECT fail_external_contact_migration($1,$2,$3)',[id,lease.lease_id,'source_auth']);expect(await scalar('SELECT source_cursor FROM external_contact_migration_jobs')).toBeNull();
 });
});
