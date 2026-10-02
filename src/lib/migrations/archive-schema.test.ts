import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {archiveSnapshot} from './archive-contract';
import {parseArchiveCollection} from './archive-collection';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',
 receipt='44444444-4444-4444-8444-444444444444',id='55555555-5555-4555-8555-555555555555',contact='66666666-6666-4666-8666-666666666666';
const source={provider:'chatwoot',origin:'https://source.example.test',accountId:7},hash='a'.repeat(64),cipher='a'.repeat(24)+':deadbeef:'+ 'b'.repeat(32);
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const create=(job=id,actor=owner,definition:unknown=source,after:string|null=null,fingerprint=hash)=>scalar('SELECT create_native_history_archive($1,$2,$3,$4,$5,$6,$7,$8)',[ws,actor,job,receipt,JSON.stringify(definition),after,fingerprint,cipher]);
const read=(actor=owner)=>scalar('SELECT read_native_history_archive($1,$2,$3)',[ws,actor,id]);
type Claim={id:string;lease_id:string;step:number;payload:ReturnType<typeof parseArchiveCollection>};
const claim=async()=>await scalar('SELECT claim_native_history_archives(2)') as Claim[];
const record=(job:Claim,payload:unknown)=>scalar('SELECT record_native_history_step($1,$2,$3,$4)',[job.id,job.lease_id,job.step,JSON.stringify(payload)]);
const conv={sourceId:'11',contactSourceId:'42',inboxSourceId:'3',state:'open',at:'2026-10-02T00:00:00Z',sourceChannel:'Channel::Api'};
const message={sourceId:'10',conversationSourceId:'11',inboxSourceId:'3',at:'2026-10-02T00:00:00Z',kind:'note',private:true,text:'Private fixture note',sourceFormat:'text',sourceDeleted:false,attachments:[]};
const finished=(job:Claim)=>({...job.payload,targetIndex:1,phase:'done',conversationIndex:1,conversations:[conv],messages:[message]});
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);CREATE TABLE workspace_subscriptions(workspace_id uuid);CREATE TABLE workspace_billing_invoices(workspace_id uuid);
 CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id),channel text,external_id text,wa_id text,phone text,name text,email text,company text,
 phone_origen text,email_origen text,union_bloqueada boolean DEFAULT false,opted_out boolean DEFAULT false,opted_out_at timestamptz,opted_out_reason text,UNIQUE(workspace_id,id));
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);CREATE TABLE storage.objects(bucket_id text,name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE POLICY fixture_broad_policy ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
 GRANT USAGE ON SCHEMA public,storage TO anon,authenticated,service_role;GRANT ALL ON storage.objects TO anon,authenticated,service_role;GRANT SELECT ON storage.buckets TO service_role;
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;`);
 for(const path of ['360_contact_migration_receipts.sql','361_native_contact_migration_jobs.sql','362_native_contact_review_authority.sql','363_private_history_archives.sql'])await db.exec(readFileSync('supabase/migrations/'+path,'utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE native_history_archive_objects,storage.objects,contacts,workspace_members,workspace_subscriptions,workspace_billing_invoices,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[ws,owner]);
 await db.query("INSERT INTO contacts(id,workspace_id,phone) VALUES($1,$2,'+573001112233')",[contact,ws]);
 await db.query("INSERT INTO contact_migration_jobs(id,workspace_id,actor_id,provider,account,input_hash,revision,state,total,new_count,existing_count,excluded_count,created_count,completed_at) VALUES($1,$2,$3,'chatwoot','https://source.example.test#7',$4,$4,'completed',1,1,0,0,1,clock_timestamp())",[receipt,ws,owner,hash]);
 await db.query("INSERT INTO contact_migration_sources VALUES($1,'chatwoot','https://source.example.test#7',$2,'42','573001112233',$3,$4)",[ws,hash,receipt,contact]);
});
describe('Private archive authority and storage lifecycle',()=>{
 it('is service-RPC only and restricts archive storage even under a broad existing policy',async()=>{
  expect(await scalar('SELECT native_history_archive_ready()')).toBe(true);
  await db.exec("INSERT INTO storage.objects VALUES('migration-archives','fixture'),('other-bucket','public-fixture')");
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM native_history_archives')).rejects.toThrow('permission denied');
   await expect(db.exec('SELECT * FROM native_history_archive_objects')).rejects.toThrow('permission denied');
   if(role!=='service_role'){expect(await scalar('SELECT count(*) FROM storage.objects')).toBe(1);await expect(create()).rejects.toThrow('permission denied');
    await expect(db.exec("INSERT INTO storage.objects VALUES('migration-archives','forged')")).rejects.toThrow('row-level security');}
   await db.exec('RESET ROLE');
  }
 });
 it('captures only the actor completed contact receipt, hides tokens and keeps retry input immutable',async()=>{
  const result=archiveSnapshot.parse(await create());expect(result).toMatchObject({state:'queued',targets:1,messages:0,files:0});expect(JSON.stringify(result)).not.toContain('deadbeef');expect(await create()).toEqual(result);
  await expect(create(id,owner,source,null,'b'.repeat(64))).rejects.toThrow('native_history_archive_changed');
  await expect(create(id,other)).rejects.toThrow('contact_migration_not_found');await expect(read(other)).rejects.toThrow('contact_migration_not_found');
  await expect(create('77777777-7777-4777-8777-777777777777',owner,{...source,accountId:8})).rejects.toThrow('native_history_archive_not_found');
 });
 it('persists one strict step and requires independent current revision confirmation without creating messages or contacts',async()=>{
  await create();const [job]=await claim();expect(parseArchiveCollection(job.payload)).toMatchObject({phase:'initial',targets:[{contactId:contact,sourceId:'42'}]});
  expect(await record(job,finished(job))).toBe(true);const ready=archiveSnapshot.parse(await read());expect(ready).toMatchObject({state:'ready',messages:1,conversations:1,files:0,contacts_collected:1});
  expect(await scalar('SELECT credential_ciphertext FROM native_history_archives')).toBeNull();
  await expect(scalar('SELECT confirm_native_history_archive($1,$2,$3,$4)',[ws,owner,id,'b'.repeat(64)])).rejects.toThrow('native_history_archive_changed');
  const done=archiveSnapshot.parse(await scalar('SELECT confirm_native_history_archive($1,$2,$3,$4)',[ws,owner,id,ready.revision]));expect(done.state).toBe('confirmed');
  expect(await scalar('SELECT confirm_native_history_archive($1,$2,$3,$4)',[ws,owner,id,ready.revision])).toEqual(done);
  const page=await scalar('SELECT read_native_history_messages($1,$2,$3,0)',[ws,owner,id]);expect(page).toMatchObject({total:1,rows:[{message:{private:true,kind:'note'},target:{contactId:contact}}],next:null});
  expect(await scalar('SELECT count(*) FROM contacts')).toBe(1);
 });
 it('invalidates old leases and rejects forged target cohorts',async()=>{
  await create();const [old]=await claim();await db.exec("UPDATE native_history_archives SET lease_until=clock_timestamp()-interval '1 second'");const [fresh]=await claim();
  expect(await record(old,finished(old))).toBe(false);await expect(record(fresh,{...finished(fresh),targets:[]})).rejects.toThrow('native_history_archive_changed');expect(await record(fresh,finished(fresh))).toBe(true);
 });
 it('checks current billing and source mapping again before IO and commit',async()=>{
  await create();const [job]=await claim();await db.exec('UPDATE workspaces SET writable=false');
  await expect(scalar('SELECT authorize_native_history_step($1,$2)',[id,job.lease_id])).rejects.toThrow('contact_migration_read_only');await expect(record(job,finished(job))).rejects.toThrow('contact_migration_read_only');
  await db.exec('UPDATE workspaces SET writable=true;DELETE FROM contacts');await expect(record(job,finished(job))).rejects.toThrow('native_history_archive_changed');
  expect(archiveSnapshot.parse(await read()).state).toBe('expired');
 });
 it('requires live registered exact upload intents and erases reference credentials when collection finishes',async()=>{
  await create();let [job]=await claim();const payload={...finished(job),phase:'files',messages:[{...message,attachments:[{sourceId:'99',type:'image',bytes:3,referenceCiphertext:cipher}]}]};
  expect(await record(job,payload)).toBe(true);expect(await scalar('SELECT credential_ciphertext FROM native_history_archives')).toBeNull();[job]=await claim();
  const path=await scalar('SELECT register_native_history_object($1,$2,$3,$4)',[id,job.lease_id,'10','99']);expect(path).toBe(`${id}/${job.lease_id}/99`);
  const complete={...job.payload,phase:'done',messages:[{...message,attachments:[{sourceId:'99',type:'image',bytes:3,referenceCiphertext:null}]}],storedFiles:[{messageId:'10',fileId:'99',path,mime:'image/png',bytes:3,sha256:hash}]};
  await expect(record(job,{...complete,storedFiles:[{...complete.storedFiles[0],path:'forged'}]})).rejects.toThrow('native_history_archive_changed');expect(await record(job,complete)).toBe(true);
  expect(await scalar('SELECT read_native_history_file($1,$2,$3,$4)',[ws,owner,id,'99'])).toMatchObject({path,bytes:3});
  expect(await scalar('SELECT list_native_history_orphans(20)')).toEqual([]);
 });
 it('records lost upload responses as eventual exact-path cleanup and never exposes a cancelled staged file',async()=>{
  await create();let [job]=await claim();await record(job,{...finished(job),phase:'files',messages:[{...message,attachments:[{sourceId:'99',type:'image',bytes:3,referenceCiphertext:cipher}]}]});[job]=await claim();
  const path=await scalar('SELECT register_native_history_object($1,$2,$3,$4)',[id,job.lease_id,'10','99']);
  await scalar('SELECT cancel_native_history_archive($1,$2,$3,false)',[ws,owner,id]);
  await expect(scalar('SELECT read_native_history_file($1,$2,$3,$4)',[ws,owner,id,'99'])).rejects.toThrow('native_history_archive_changed');
  expect(await scalar('SELECT list_native_history_orphans(20)')).toEqual([]);await db.exec("UPDATE native_history_archive_objects SET created_at=clock_timestamp()-interval '121 seconds'");
  expect(await scalar('SELECT list_native_history_orphans(20)')).toEqual([{path}]);expect(await scalar('SELECT forget_native_history_orphan($1)',[path])).toBe(true);
 });
 it('expiry does not delete confirmed history, but explicit deletion or lost contact authority does',async()=>{
  await create();const [job]=await claim();await record(job,finished(job));const ready=archiveSnapshot.parse(await read());await scalar('SELECT confirm_native_history_archive($1,$2,$3,$4)',[ws,owner,id,ready.revision]);
  await db.exec("UPDATE native_history_archives SET created_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 second'");expect(archiveSnapshot.parse(await read()).state).toBe('confirmed');
  expect(await scalar('SELECT cancel_native_history_archive($1,$2,$3,false)',[ws,owner,id])).toMatchObject({state:'confirmed'});
  expect(await scalar('SELECT cancel_native_history_archive($1,$2,$3,true)',[ws,owner,id])).toMatchObject({state:'cancelled'});expect(await scalar('SELECT payload FROM native_history_archives')).toBeNull();
 });
 it('purges revoked confirmed archives and rotates successful privacy checks',async()=>{
  await create();const [job]=await claim();await record(job,finished(job));const ready=archiveSnapshot.parse(await read());await scalar('SELECT confirm_native_history_archive($1,$2,$3,$4)',[ws,owner,id,ready.revision]);
  expect(await scalar('SELECT purge_native_history_archives()')).toBe(0);await db.exec('UPDATE workspaces SET deleted_at=clock_timestamp()');
  expect(await scalar('SELECT purge_native_history_archives()')).toBe(1);expect(await scalar('SELECT payload FROM native_history_archives')).toBeNull();
 });
 it('bounds transient retries and clears source credentials after a definitive failure',async()=>{
  await create();for(let i=0;i<4;i++){const [job]=await claim();await scalar('SELECT fail_native_history_archive($1,$2,$3)',[id,job.lease_id,'source_rate_limit']);if(i<3)await db.exec("UPDATE native_history_archives SET available_at=clock_timestamp()-interval '1 second'");}
  expect(archiveSnapshot.parse(await read())).toMatchObject({state:'failed',error:'source_rate_limit'});expect(await scalar('SELECT credential_ciphertext FROM native_history_archives')).toBeNull();
 });
});
