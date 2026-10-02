import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {nativeSourceSnapshot} from './native-source-contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555';
const source={provider:'chatwoot',origin:'https://source.example.test',accountId:7},fingerprint='a'.repeat(64),cipher='a'.repeat(24)+':deadbeef:'+ 'b'.repeat(32);
const row=(n=1)=>({sourceId:String(n),phone:'+573001112233',name:'Fixture',email:'person@example.test',company:''});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const create=(job=id,actor=owner,definition:unknown=source,hash=fingerprint)=>scalar('SELECT create_native_contact_migration($1,$2,$3,$4,$5,$6)',[ws,actor,job,JSON.stringify(definition),hash,cipher]);
const read=(job=id,actor=owner,after=0)=>scalar('SELECT read_native_contact_migration($1,$2,$3,$4)',[ws,actor,job,after]);
const claim=async()=>await scalar('SELECT claim_native_contact_migrations(2)') as Array<{id:string;lease_id:string;page:number;credential_ciphertext:string}>;
const record=(lease:string,page=1,total=1,rows:unknown[]=[row()],job=id)=>scalar('SELECT record_native_contact_page($1,$2,$3,$4,$5)',[job,lease,page,total,JSON.stringify(rows)]);
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
 await db.exec(readFileSync('supabase/migrations/361_native_contact_migration_jobs.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/362_native_contact_review_authority.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE contacts,workspace_members,workspace_subscriptions,workspace_billing_invoices,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2),($3)',[owner,admin,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin','[\"/contactos\"]')",[ws,admin]);
});
describe('Private durable native contact collection',()=>{
 it('locks source authority in the review transaction and rejects an intervening cancellation',async()=>{
  expect(await scalar('SELECT native_contact_review_ready()')).toBe(true);await create();const [lease]=await claim();await record(lease.lease_id);
  const reviewRows=[{...row(),row:2,issues:[]}],review='66666666-6666-4666-8666-666666666666';
  expect(await scalar('SELECT prepare_native_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify(reviewRows)])).toMatchObject({state:'prepared',account:'https://source.example.test#7'});
  await scalar('SELECT cancel_native_contact_migration($1,$2,$3)',[ws,owner,id]);
  await expect(scalar('SELECT prepare_native_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify(reviewRows)])).rejects.toThrow('native_contact_migration_changed');
  expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it('refuses foreign source row cohorts and native expiration even when copied rows already exist in service memory',async()=>{
  await create();const [lease]=await claim();await record(lease.lease_id);const review='66666666-6666-4666-8666-666666666666';
  await expect(scalar('SELECT prepare_native_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify([{...row(2),row:2,issues:[]}])])).rejects.toThrow('native_contact_migration_changed');
  await db.exec("UPDATE native_contact_migration_jobs SET expires_at=clock_timestamp()-interval '1 second'");
  await expect(scalar('SELECT prepare_native_contact_review($1,$2,$3,$4,$5,$6)',[ws,owner,id,review,fingerprint,JSON.stringify([{...row(),row:2,issues:[]}])])).rejects.toThrow('native_contact_migration_changed');
  expect(await scalar('SELECT count(*) FROM contact_migration_jobs')).toBe(0);
 });
 it('keeps credentials and projected data inaccessible outside fixed private RPCs',async()=>{
  expect(await scalar('SELECT native_contact_migration_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM native_contact_migration_jobs')).rejects.toThrow('permission denied');
   if(role!=='service_role'){await expect(create()).rejects.toThrow('permission denied');await expect(claim()).rejects.toThrow('permission denied');}
   await db.exec('RESET ROLE');
  }
 });
 it('creates only a queue item, keeps retries immutable and hides credentials from the receipt',async()=>{
  const saved=nativeSourceSnapshot.parse(await create());expect(saved).toMatchObject({state:'queued',total:null,collected:0,rows:[],next:null});
  expect(JSON.stringify(saved)).not.toContain('deadbeef');expect(await create()).toEqual(saved);expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
  await expect(create(id,owner,source,'c'.repeat(64))).rejects.toThrow('native_contact_migration_changed');
  await expect(create(id,admin)).rejects.toThrow('native_contact_migration_not_found');await expect(read(id,admin)).rejects.toThrow('native_contact_migration_not_found');
 });
 it('paginates without a browser credential, purges the token on completion and exposes only 25-row samples',async()=>{
  await create();let [lease]=await claim();expect(lease.credential_ciphertext).toBe(cipher);
  expect(await scalar('SELECT authorize_native_contact_page($1,$2)',[id,lease.lease_id])).toBe(true);
  expect(await record(lease.lease_id,1,26,Array.from({length:15},(_,i)=>row(i+1)))).toBe(true);
  expect(await record(lease.lease_id,1,26,[])).toBe(false);[lease]=await claim();expect(lease.page).toBe(2);
  await record(lease.lease_id,2,26,Array.from({length:11},(_,i)=>row(i+16)));
  const ready=nativeSourceSnapshot.parse(await read());expect(ready).toMatchObject({state:'ready',collected:26,total:26,next:25});expect(ready.rows).toHaveLength(25);
  expect(nativeSourceSnapshot.parse(await read(id,owner,25)).rows).toEqual([row(26)]);expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();
  expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);expect(await claim()).toEqual([]);
 });
 it('reports an empty source explicitly and erases its credential and payload',async()=>{
  await create();const [lease]=await claim();await record(lease.lease_id,1,0,[]);expect(nativeSourceSnapshot.parse(await read())).toMatchObject({state:'empty',total:0,collected:0});
  expect(await scalar('SELECT payload FROM native_contact_migration_jobs')).toBeNull();expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();
 });
 it.each(['duplicate','count','page','short','injected','oversize'] as const)('fails closed on %s pages without moving the cursor',async mode=>{
  await create();const [lease]=await claim();const rows=Array.from({length:15},(_,i)=>row(i+1));
  if(mode==='duplicate')rows[1]=row(1);if(mode==='short')rows.pop();if(mode==='injected')Object.assign(rows[0],{workspace_id:other});if(mode==='oversize')rows[0].name='x'.repeat(4097);
  await expect(record(lease.lease_id,mode==='page'?2:1,mode==='count'?14:26,rows)).rejects.toThrow();expect(await scalar('SELECT collected FROM native_contact_migration_jobs')).toBe(0);
 });
 it('refuses duplicate source IDs and total drift across pages',async()=>{
  await create();let [lease]=await claim();await record(lease.lease_id,1,16,Array.from({length:15},(_,i)=>row(i+1)));[lease]=await claim();
  await expect(record(lease.lease_id,2,17,[row(16),row(17)])).rejects.toThrow('native_contact_migration_changed');
  await expect(record(lease.lease_id,2,16,[row(1)])).rejects.toThrow('native_contact_migration_changed');expect(await scalar('SELECT collected FROM native_contact_migration_jobs')).toBe(15);
 });
 it.each(['role','sections','member','billing','workspace'] as const)('checks current %s at claim and before outbound work',async change=>{
  await create(id,admin);const [lease]=await claim();
  if(change==='role')await db.exec("UPDATE workspace_members SET role='agent'");if(change==='sections')await db.exec("UPDATE workspace_members SET allowed_sections='[]'");
  if(change==='member')await db.exec('DELETE FROM workspace_members');if(change==='billing')await db.exec('UPDATE workspaces SET writable=false');if(change==='workspace')await db.exec('UPDATE workspaces SET deleted_at=now()');
  await expect(scalar('SELECT authorize_native_contact_page($1,$2)',[id,lease.lease_id])).rejects.toThrow(change==='billing'?'contact_migration_read_only':'contact_migration_not_found');
  await expect(record(lease.lease_id)).rejects.toThrow();await db.exec("UPDATE native_contact_migration_jobs SET lease_until=clock_timestamp()-interval '1 second'");
  expect(await claim()).toEqual([]);expect(await scalar('SELECT state FROM native_contact_migration_jobs')).toBe('cancelled');expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();
 });
 it('enforces a fresh lease after a restart and ignores abandoned worker responses',async()=>{
  await create();const [old]=await claim();expect(await claim()).toEqual([]);await db.exec("UPDATE native_contact_migration_jobs SET lease_until=clock_timestamp()-interval '1 second'");
  const [fresh]=await claim();expect(fresh.lease_id).not.toBe(old.lease_id);expect(await record(old.lease_id)).toBe(false);expect(await record(fresh.lease_id)).toBe(true);
 });
 it('retries transient reads with bounded pauses and purges credentials after the final failure',async()=>{
  await create();for(let attempt=0;attempt<4;attempt++){
   const [lease]=await claim();expect(await scalar('SELECT fail_native_contact_migration($1,$2,$3)',[id,lease.lease_id,'source_rate_limit'])).toBe(true);
   expect(await claim()).toEqual([]);if(attempt<3)await db.exec("UPDATE native_contact_migration_jobs SET available_at=clock_timestamp()-interval '1 second'");
  }
  expect(await scalar('SELECT state FROM native_contact_migration_jobs')).toBe('failed');expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();
 });
 it.each(['source_auth','source_changed','source_credential_unavailable','source_access_revoked'])('does not retry %s or retain its secret',async code=>{
  await create();const [lease]=await claim();await scalar('SELECT fail_native_contact_migration($1,$2,$3)',[id,lease.lease_id,code]);
  expect(nativeSourceSnapshot.parse(await read())).toMatchObject({state:'failed',error:code});expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();expect(await scalar('SELECT payload FROM native_contact_migration_jobs')).toBeNull();
 });
 it('cancels queued, fetching or ready work, invalidates its lease and permits read-only cancellation',async()=>{
  await create();const [lease]=await claim();await db.exec('UPDATE workspaces SET writable=false');
  expect(await scalar('SELECT cancel_native_contact_migration($1,$2,$3)',[ws,owner,id])).toMatchObject({state:'cancelled',rows:[]});expect(await record(lease.lease_id)).toBe(false);
  expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();
 });
 it('expires reads and service review access independently of the daily physical sweep',async()=>{
  await create();const [lease]=await claim();await record(lease.lease_id);await db.exec("UPDATE native_contact_migration_jobs SET created_at=clock_timestamp()-interval '3 hours',expires_at=clock_timestamp()-interval '1 second'");
  await expect(scalar('SELECT read_native_contact_payload($1,$2,$3)',[ws,owner,id])).rejects.toThrow('native_contact_migration_changed');
  expect(nativeSourceSnapshot.parse(await read()).state).toBe('expired');expect(await scalar('SELECT payload FROM native_contact_migration_jobs')).toBeNull();
 });
 it('purges expired credentials and data, then old terminal metadata, without changing contacts',async()=>{
  await create();await db.exec("UPDATE native_contact_migration_jobs SET expires_at=clock_timestamp()-interval '1 second'");expect(await scalar('SELECT purge_native_contact_migrations()')).toBe(1);
  expect(await scalar('SELECT credential_ciphertext FROM native_contact_migration_jobs')).toBeNull();await db.exec("UPDATE native_contact_migration_jobs SET updated_at=clock_timestamp()-interval '31 days'");
  expect(await scalar('SELECT purge_native_contact_migrations()')).toBe(1);expect(await scalar('SELECT count(*) FROM native_contact_migration_jobs')).toBe(0);expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it('limits simultaneous workspace jobs while retaining immutable same-ID recovery',async()=>{
  for(let i=0;i<3;i++)await create(`77777777-7777-4777-8777-${String(i).padStart(12,'0')}`);
  await expect(create()).rejects.toThrow('native_contact_migration_limit');expect(await create('77777777-7777-4777-8777-000000000000')).toBeTruthy();
 });
 it.each([{...source,actor_id:owner},{...source,provider:'kommo'},{...source,accountId:0},{...source,accountId:9007199254740992},{...source,origin:'http://source.example.test'},{...source,origin:'https://source.example.test/path'}])('validates SQL source independently of the app',async definition=>{
  await expect(create(id,owner,definition)).rejects.toThrow('invalid_native_contact_migration');expect(await scalar('SELECT count(*) FROM native_contact_migration_jobs')).toBe(0);
 });
});
