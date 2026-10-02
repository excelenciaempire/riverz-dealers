import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {contactMigrationSnapshot} from './contact-import-contract';

const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const id='55555555-5555-4555-8555-555555555555',id2='66666666-6666-4666-8666-666666666666',hash='a'.repeat(64);
const row=(sourceId='source-1',phone='+573001112233',ordinal=2)=>({row:ordinal,sourceId,phone,name:'Test person',email:'person@example.test',company:'Fixture',issues:[] as string[]});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const prepare=(rows:unknown[]=[row()],job=id,actor=owner,input=hash)=>scalar('SELECT prepare_contact_migration($1,$2,$3,$4,$5,$6,$7)',[ws,actor,job,'chatwoot','fixture-account',input,JSON.stringify(rows)]);
const read=(actor=owner,job=id,after=0)=>scalar('SELECT read_contact_migration($1,$2,$3,$4)',[ws,actor,job,after]);
const confirm=async(revision?:string,actor=owner,job=id)=>{
 const expected=revision??contactMigrationSnapshot.parse(await read(actor,job)).revision;
 return scalar('SELECT confirm_contact_migration($1,$2,$3,$4,true)',[ws,actor,job,expected]);
};
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE workspace_subscriptions(workspace_id uuid);CREATE TABLE workspace_billing_invoices(workspace_id uuid);
 CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id),channel text,external_id text,wa_id text,
  phone text,name text,email text,company text,phone_origen text,email_origen text,union_bloqueada boolean DEFAULT false,opted_out boolean DEFAULT false,opted_out_at timestamptz,opted_out_reason text,
  UNIQUE(workspace_id,id));
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/360_contact_migration_receipts.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE contacts,workspace_members,workspace_subscriptions,workspace_billing_invoices,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2),($3)',[owner,admin,other]);
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin','[\"/contactos\"]')",[ws,admin]);
});
describe('Durable private contact migrations in PostgreSQL',()=>{
 it('keeps raw tables inaccessible even to service_role and RPCs inaccessible to browser roles',async()=>{
  expect(await scalar('SELECT contact_migration_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`SET ROLE ${role}`);
   await expect(db.exec('SELECT * FROM contact_migration_jobs')).rejects.toThrow('permission denied');
   await expect(db.exec('SELECT * FROM contact_migration_sources')).rejects.toThrow('permission denied');
   if(role!=='service_role')await expect(read()).rejects.toThrow('permission denied');
   await db.exec('RESET ROLE');
  }
 });
 it('prepares an exact paged revision without creating or changing a contact',async()=>{
  const review=contactMigrationSnapshot.parse(await prepare());
  expect(review).toMatchObject({id,workspace_id:ws,actor_id:owner,state:'prepared',counts:{total:1,new:1,existing:0,excluded:0,created:0},rows:[{...row(),state:'new',contact_id:null}]});
  expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it('commits unverified, opted-out, unlinked contacts once and purges copied review data',async()=>{
  await prepare();const saved=contactMigrationSnapshot.parse(await confirm());
  expect(saved).toMatchObject({state:'completed',rows:[],next:null,counts:{created:1}});
  const contact=(await db.query<Record<string,unknown>>('SELECT * FROM contacts')).rows[0];
  expect(contact).toMatchObject({workspace_id:ws,phone:row().phone,external_id:null,wa_id:null,phone_origen:'afirmado',email_origen:'afirmado',union_bloqueada:true,opted_out:true,opted_out_reason:'migration_consent_unverified'});
  expect(await scalar('SELECT payload FROM contact_migration_jobs')).toBeNull();
  expect(await confirm()).toEqual(saved);expect(await prepare()).toEqual(saved);expect(await scalar('SELECT count(*) FROM contacts')).toBe(1);
  const report=await scalar('SELECT read_contact_migration_results($1,$2,$3,0)',[ws,owner,id]);
  expect(report).toMatchObject({rows:[{row:2,sourceId:'source-1',state:'created',issues:[],contact_id:contact.id}]});
  expect(JSON.stringify(report)).not.toContain('person@example.test');
 });
 it('does not overwrite or claim an existing matching phone in any channel',async()=>{
  await db.query("INSERT INTO contacts(workspace_id,channel,phone,name,email,opted_out) VALUES($1,'email',$2,'Existing','old@example.test',false)",[ws,row().phone]);
  const review=contactMigrationSnapshot.parse(await prepare());expect(review.counts).toMatchObject({new:0,existing:1});expect(review.rows[0]).toMatchObject({state:'existing',contact_id:null,issues:['existing_contact']});
  await confirm();expect(await scalar('SELECT count(*) FROM contacts')).toBe(1);expect(await scalar('SELECT name FROM contacts')).toBe('Existing');expect(await scalar('SELECT opted_out FROM contacts')).toBe(false);
  expect(await scalar('SELECT count(*) FROM contact_migration_sources')).toBe(0);
 });
 it('does not treat the same email as a verified contact identity',async()=>{
  await db.query("INSERT INTO contacts(workspace_id,channel,email) VALUES($1,'email',$2)",[ws,row().email]);
  expect(contactMigrationSnapshot.parse(await prepare()).counts.new).toBe(1);await confirm();expect(await scalar('SELECT count(*) FROM contacts')).toBe(2);
 });
 it('recognizes WhatsApp transport identifiers without exposing their contact IDs',async()=>{
  await db.query("INSERT INTO contacts(workspace_id,channel,external_id) VALUES($1,'whatsapp','573001112233')",[ws]);
  expect(contactMigrationSnapshot.parse(await prepare()).counts.existing).toBe(1);
 });
 it('reimports immutable source references without creating duplicates and rejects source identity changes',async()=>{
  await prepare();await confirm();expect(contactMigrationSnapshot.parse(await prepare([row()],id2)).counts.existing).toBe(1);
  await db.exec('DELETE FROM contact_migration_jobs WHERE id=\''+id2+'\'');
  const review=contactMigrationSnapshot.parse(await prepare([row('source-1','+573001112244')],id2));
  expect(review.rows[0]).toMatchObject({state:'excluded',issues:['source_changed']});await confirm(undefined,owner,id2);expect(await scalar('SELECT count(*) FROM contacts')).toBe(1);
 });
 it('requires a fresh review if contacts or a mapped source change before confirmation',async()=>{
  await prepare();await db.query('INSERT INTO contacts(workspace_id,phone) VALUES($1,$2)',[ws,row().phone]);
  await expect(confirm()).rejects.toThrow('contact_migration_changed');expect(await scalar('SELECT state FROM contact_migration_jobs')).toBe('prepared');expect(await scalar('SELECT count(*) FROM contacts')).toBe(1);
 });
 it('keeps all insertions and the receipt atomic if provenance storage fails',async()=>{
  await prepare([row(),row('source-2','+573001112244',3)]);
  await db.exec(`CREATE FUNCTION fail_migration_source() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_id='source-2' THEN RAISE EXCEPTION 'synthetic provenance failure';END IF;RETURN NEW;END$$;
   CREATE TRIGGER fail_migration_source BEFORE INSERT ON contact_migration_sources FOR EACH ROW EXECUTE FUNCTION fail_migration_source();`);
  await expect(confirm()).rejects.toThrow('synthetic provenance failure');expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);expect(await scalar('SELECT count(*) FROM contact_migration_sources')).toBe(0);
  expect(await scalar('SELECT state FROM contact_migration_jobs')).toBe('prepared');
  await db.exec('DROP TRIGGER fail_migration_source ON contact_migration_sources;DROP FUNCTION fail_migration_source()');
 });
 it.each(['role','sections','membership','workspace'])('rechecks current %s before confirmation and receipt reads',async change=>{
  await prepare([row()],id,admin);
  if(change==='role')await db.exec("UPDATE workspace_members SET role='agent'");
  if(change==='sections')await db.exec("UPDATE workspace_members SET allowed_sections='{}'");
  if(change==='membership')await db.exec('DELETE FROM workspace_members');
  if(change==='workspace')await db.exec('UPDATE workspaces SET deleted_at=now()');
  await expect(confirm(hash,admin)).rejects.toThrow('contact_migration_not_found');await expect(read(admin)).rejects.toThrow('contact_migration_not_found');
  expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
 });
 it('keeps each private review actor-scoped, including between two current administrators',async()=>{
  await prepare();await expect(read(admin)).rejects.toThrow('contact_migration_not_found');await expect(prepare([row()],id,admin)).rejects.toThrow('contact_migration_not_found');
  await expect(scalar('SELECT read_contact_migration($1,$2,$3,0)',[other,other,id])).rejects.toThrow('contact_migration_not_found');
 });
 it('checks overdue billing before a new prepare or commit but can recover a committed receipt',async()=>{
  await db.exec('UPDATE workspaces SET writable=false');await expect(prepare()).rejects.toThrow('contact_migration_read_only');await db.exec('UPDATE workspaces SET writable=true');
  await prepare();await db.exec('UPDATE workspaces SET writable=false');await expect(confirm()).rejects.toThrow('contact_migration_read_only');expect(await scalar('SELECT count(*) FROM contacts')).toBe(0);
  await db.exec('UPDATE workspaces SET writable=true');const saved=await confirm();await db.exec('UPDATE workspaces SET writable=false');expect(await confirm()).toEqual(saved);
 });
 it('expires abandoned payloads on read and rejects expired or mismatched confirmations',async()=>{
  await prepare();const revision=contactMigrationSnapshot.parse(await read()).revision;await expect(confirm(hash)).rejects.toThrow('contact_migration_changed');
  await db.exec("UPDATE contact_migration_jobs SET prepared_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second'");await expect(confirm(revision)).rejects.toThrow('contact_migration_expired');
  expect(contactMigrationSnapshot.parse(await read())).toMatchObject({state:'expired',rows:[],next:null});expect(await scalar('SELECT payload FROM contact_migration_jobs')).toBeNull();
 });
 it('rejects reused IDs with a different input and requires literal confirmation',async()=>{
  const review=contactMigrationSnapshot.parse(await prepare());await expect(prepare([row()],id,owner,'b'.repeat(64))).rejects.toThrow('contact_migration_changed');
  await expect(scalar('SELECT confirm_contact_migration($1,$2,$3,$4,false)',[ws,owner,id,review.revision])).rejects.toThrow('invalid_contact_migration');
  await expect(scalar('SELECT confirm_contact_migration(NULL,NULL,NULL,NULL,NULL)')).rejects.toThrow('invalid_contact_migration');
 });
 it('returns all rows through a stable 25-row cursor without truncating the approval counts',async()=>{
  const rows=Array.from({length:51},(_,i)=>({...row('source-'+i,'',i+2),issues:['phone_invalid']}));
  const first=contactMigrationSnapshot.parse(await prepare(rows));expect(first.counts).toMatchObject({total:51,excluded:51});expect(first.rows).toHaveLength(25);expect(first.next).toBe(26);
  const second=contactMigrationSnapshot.parse(await read(owner,id,26));expect(second.rows[0].row).toBe(27);expect(second.next).toBe(51);
  const last=contactMigrationSnapshot.parse(await read(owner,id,51));expect(last.rows).toHaveLength(1);expect(last.next).toBeNull();
 });
 it.each([[{...row(),row:2.5}],[{...row(),row:3}],[{...row(),issues:null}],[{...row(),issues:['bogus']}],[{...row(),issues:['duplicate','duplicate']}],
  [{...row(),workspace_id:other}],[{...row(),sourceId:''}],[{...row(),phone:'573001112233'}],[{...row(),email:'broken'}],
  [row(),row('source-2',row().phone,3)],[row(),row('source-1','+573001112244',3)],[]].map(rows=>({rows})))('validates SQL input independently of the application (%#)',async({rows})=>{
  await expect(prepare(rows)).rejects.toThrow('invalid_contact_migration');expect(await scalar('SELECT count(*) FROM contact_migration_jobs')).toBe(0);
 });
 it('limits retained reviews and permits recovery of the same ID at the limit',async()=>{
  for(let i=0;i<10;i++)await prepare([row()],`77777777-7777-4777-8777-${String(i).padStart(12,'0')}`);
  await expect(prepare()).rejects.toThrow('contact_migration_limit');expect(await prepare([row()],'77777777-7777-4777-8777-000000000000')).toBeTruthy();
 });
 it('cannot attach a provenance record to a contact from another workspace',async()=>{
  await prepare();const foreign=await scalar('INSERT INTO contacts(workspace_id,phone) VALUES($1,$2) RETURNING id',[other,row().phone]);
  await expect(db.query('INSERT INTO contact_migration_sources VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ws,'chatwoot','fixture-account',hash,'source-1','573001112233',id,foreign])).rejects.toThrow('foreign key');
 });
 it('physically clears expired previews and old receipt details without deleting contacts or provenance',async()=>{
  await prepare();await confirm();await db.exec("UPDATE contact_migration_jobs SET completed_at=clock_timestamp()-interval '31 days'");
  await prepare([row('source-2','+573001112244')],id2);await db.query("UPDATE contact_migration_jobs SET prepared_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id2]);
  expect(await scalar('SELECT purge_contact_migration_payloads()')).toBe(2);expect(await scalar('SELECT count(*) FROM contacts')).toBe(1);expect(await scalar('SELECT count(*) FROM contact_migration_sources')).toBe(1);
  expect(contactMigrationSnapshot.parse(await read(owner,id2))).toMatchObject({state:'expired',rows:[]});
  await expect(scalar('SELECT read_contact_migration_results($1,$2,$3,0)',[ws,owner,id])).rejects.toThrow('contact_migration_expired');expect(await scalar('SELECT purge_contact_migration_payloads()')).toBe(0);
 });
 it('removes imported source links with their contact while preserving historical import counts',async()=>{
  await prepare();await confirm();await db.exec('DELETE FROM contacts');expect(await scalar('SELECT count(*) FROM contact_migration_sources')).toBe(0);
  expect(contactMigrationSnapshot.parse(await read()).counts.created).toBe(1);
 });
 it('handles 5,000 excluded rows without truncating the private review or receipt',async()=>{
  const rows=Array.from({length:5000},(_,index)=>({...row('source-'+index,'',index+2),issues:['phone_invalid']}));
  expect(contactMigrationSnapshot.parse(await prepare(rows)).counts).toMatchObject({total:5000,excluded:5000});
  expect(contactMigrationSnapshot.parse(await confirm()).counts.created).toBe(0);expect(await scalar('SELECT jsonb_array_length(results) FROM contact_migration_jobs')).toBe(5000);
  await expect(prepare([...rows,{...row('overflow','',5002),issues:['phone_invalid']}],id2)).rejects.toThrow('invalid_contact_migration');
 },20000);
});
