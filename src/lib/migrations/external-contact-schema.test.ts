import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {externalSourceSnapshot} from './external-source-contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555';
const source={provider:'kommo',origin:'https://fixture.kommo.com',accountId:7},fingerprint='a'.repeat(64),cipher='a'.repeat(24)+':deadbeef:'+ 'b'.repeat(32);
const row=(n=1)=>({sourceId:String(n),phone:'+573001112233',name:'Fixture',email:'person@example.test',company:''});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const create=(job=id,actor=owner,definition:unknown=source,hash=fingerprint)=>scalar('SELECT create_external_contact_migration($1,$2,$3,$4,$5,$6)',[ws,actor,job,JSON.stringify(definition),hash,cipher]);
const read=(job=id,actor=owner,after=0)=>scalar('SELECT read_external_contact_migration($1,$2,$3,$4)',[ws,actor,job,after]);
const claim=async()=>await scalar('SELECT claim_external_contact_migrations(2)') as Array<{id:string;lease_id:string;page:number;credential_ciphertext:string}>;
const record=(lease:string,page=1,done=true,rows:unknown[]=[row()],job=id)=>scalar('SELECT record_external_contact_page($1,$2,$3,$4,$5)',[job,lease,page,done,JSON.stringify(rows)]);
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
describe('Private Kommo and selected ManyChat collection',()=>{
 it('keeps all provider jobs private and separately prepared from imports',async()=>{
  expect(await scalar('SELECT external_contact_review_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM external_contact_migration_jobs')).rejects.toThrow('permission denied');if(role!=='service_role')await expect(create()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
  const saved=externalSourceSnapshot.parse(await create());expect(saved).toMatchObject({state:'queued',total:null,collected:0});expect(JSON.stringify(saved)).not.toContain('deadbeef');expect(await create()).toEqual(saved);
  await expect(create(id,owner,source,'b'.repeat(64))).rejects.toThrow('external_contact_migration_changed');expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it('records an observed listing with unknown total until the terminal short page',async()=>{
  await create();let [lease]=await claim();expect(lease).toMatchObject({page:1,last_id:0});await record(lease.lease_id,1,false,Array.from({length:25},(_,i)=>row(i+1)));
  expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'queued',total:null,collected:25,rows:[]});await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();expect(lease).toMatchObject({page:2,last_id:25});await record(lease.lease_id,2,true,[row(26)]);
  expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'ready',total:26,collected:26,next:25});expect(externalSourceSnapshot.parse(await read(id,owner,25)).rows).toEqual([row(26)]);expect(await scalar('SELECT credential_ciphertext FROM external_contact_migration_jobs')).toBeNull();
 });
 it('waits for an empty boundary after a full last page instead of inventing a known total',async()=>{
  await create();let [lease]=await claim();await record(lease.lease_id,1,false,Array.from({length:25},(_,i)=>row(i+1)));await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();await record(lease.lease_id,2,true,[]);expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'ready',total:25,collected:25});
 });
 it('erases payload and credentials for a genuinely empty listing',async()=>{await create();const [lease]=await claim();await record(lease.lease_id,1,true,[]);expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'empty',total:0,collected:0});expect(await scalar('SELECT payload FROM external_contact_migration_jobs')).toBeNull();});
 it.each(['short','fullDone','descending','extra','wrongPage','duplicate'] as const)('rejects %s pages without advancing',async mode=>{
  await create();const [lease]=await claim(),rows=Array.from({length:25},(_,i)=>row(i+1));if(mode==='short')rows.pop();if(mode==='descending')rows.reverse();if(mode==='extra')Object.assign(rows[0],{token:'PRIVATE'});if(mode==='duplicate')rows[1]=row(1);
  await expect(record(lease.lease_id,mode==='wrongPage'?2:1,mode==='fullDone',rows)).rejects.toThrow();expect(await scalar('SELECT collected FROM external_contact_migration_jobs')).toBe(0);
 });
 it('checks selected IDs and terminal conditions independently of the worker',async()=>{
  const selected={provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[42,43]};await create(id,owner,selected);let [lease]=await claim();
  await expect(record(lease.lease_id,1,true,[row(42)])).rejects.toThrow('external_contact_migration_changed');await expect(record(lease.lease_id,1,false,[row(99)])).rejects.toThrow('external_contact_migration_changed');await record(lease.lease_id,1,false,[row(42)]);
  await db.exec("UPDATE external_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");[lease]=await claim();await record(lease.lease_id,2,true,[row(43)]);
  expect(externalSourceSnapshot.parse(await read())).toMatchObject({state:'ready',total:2,collected:2,rows:[row(42),row(43)]});
 });
 it('binds the external source to a separate review transaction and rejects cancelled sources',async()=>{
  await create();const [lease]=await claim();await record(lease.lease_id);const review='66666666-6666-4666-8666-666666666666',rows=[{...row(),row:2,issues:[]}];
  expect(await scalar('SELECT prepare_external_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify(rows)])).toMatchObject({state:'prepared',provider:'kommo',account:'https://fixture.kommo.com#7'});
  await scalar('SELECT cancel_external_contact_migration($1,$2,$3)',[ws,owner,id]);await expect(scalar('SELECT prepare_external_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify(rows)])).rejects.toThrow('external_contact_migration_changed');expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it.each(['role','sections','billing','workspace'] as const)('rechecks current %s before reads and page recording',async mode=>{
  await create(id,admin);const [lease]=await claim();if(mode==='role')await db.exec("UPDATE workspace_members SET role='agent'");if(mode==='sections')await db.exec("UPDATE workspace_members SET allowed_sections='[]'");if(mode==='billing')await db.exec('UPDATE workspaces SET writable=false');if(mode==='workspace')await db.exec('UPDATE workspaces SET deleted_at=clock_timestamp()');
  await expect(scalar('SELECT authorize_external_contact_page($1,$2)',[id,lease.lease_id])).rejects.toThrow();await expect(record(lease.lease_id)).rejects.toThrow();await db.exec("UPDATE external_contact_migration_jobs SET lease_until=clock_timestamp()-interval '1 second'");expect(await claim()).toEqual([]);expect(await scalar('SELECT credential_ciphertext FROM external_contact_migration_jobs')).toBeNull();
 });
 it('rejects foreign actors and fresh source responses after cancellation or expiry',async()=>{
  await create();const [lease]=await claim();await expect(read(id,admin)).rejects.toThrow('external_contact_migration_not_found');await scalar('SELECT cancel_external_contact_migration($1,$2,$3)',[ws,owner,id]);expect(await record(lease.lease_id)).toBe(false);
 });
 it('purges expired secrets independently of worker execution',async()=>{
  await create();await db.exec("UPDATE external_contact_migration_jobs SET expires_at=clock_timestamp()-interval '1 second'");expect(await scalar('SELECT purge_external_contact_migrations()')).toBe(1);expect(await scalar('SELECT credential_ciphertext FROM external_contact_migration_jobs')).toBeNull();expect(await scalar('SELECT payload FROM external_contact_migration_jobs')).toBeNull();
 });
 it.each([
  {...source,origin:'https://fixture.kommo.com.evil.test'}, {...source,provider:'leadsales'}, {...source,accountId:9007199254740992}, {...source,workspace_id:ws},
  {provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[42,42]}, {provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:['42']},
  {provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[9007199254740992]}, {provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[]},
 ])('enforces source and ID scope in SQL',async definition=>{await expect(create(id,owner,definition)).rejects.toThrow('invalid_external_contact_migration');expect(await scalar('SELECT count(*) FROM external_contact_migration_jobs')).toBe(0);});
});
