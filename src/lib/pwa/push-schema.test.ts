import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',member='33333333-3333-4333-8333-333333333333';
const other='44444444-4444-4444-8444-444444444444',conv='55555555-5555-4555-8555-555555555555',connection='66666666-6666-4666-8666-666666666666',notice='77777777-7777-4777-8777-777777777777';
const cipher='a'.repeat(200),hash='b'.repeat(64);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid,channel text);
 CREATE TABLE workspace_notifications(id uuid PRIMARY KEY,workspace_id uuid,user_id uuid,conversation_id uuid,read_at timestamptz,created_at timestamptz DEFAULT now(),kind text,body text);`);
 await db.exec(readFileSync('supabase/migrations/350_browser_push_notices.sql','utf8'));
},30_000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE browser_push_receipts,browser_push_subscriptions,workspace_notifications,conversations,channel_connections,workspace_members,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2),($3)',[owner,member,other]);await db.query('INSERT INTO workspaces VALUES($1,$2,NULL),($3,$3,NULL)',[ws,owner,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,member]);await db.query("INSERT INTO conversations VALUES($1,$2,'whatsapp',NULL,NULL)",[conv,ws]);
});
async function scalar(sql:string,args:unknown[]=[]){return Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];}
const manage=(operation='save',actor=member,target=ws,endpoint=hash)=>scalar('SELECT manage_browser_push($1,$2,$3,$4,$5,$6)',[target,actor,endpoint,operation,operation==='save'?cipher:null,operation==='save'?'es':null]);
async function notify(actor=member,target=ws){await db.query("INSERT INTO workspace_notifications VALUES($1,$2,$3,$4,NULL,now(),'mention','PRIVATE CUSTOMER NOTE')",[notice,target,actor,conv]);}
const claims=()=>scalar('SELECT claim_browser_push_notices()') as Promise<Array<{id:string;lease_id:string;notice:unknown}>>;
const finish=(id:string,lease:string,state='acknowledged',status:number|null=201)=>scalar('SELECT finish_browser_push_notice($1,$2,$3,$4)',[id,lease,state,status]);
describe('Opt-in browser notice authority and one-attempt receipts',()=>{
 it('guards private storage and RPCs without direct authenticated or service writes',async()=>{
  expect(await scalar('SELECT browser_push_schema_ready()')).toBe(true);
  for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await expect(manage()).rejects.toThrow('permission denied');await expect(db.exec('SELECT * FROM browser_push_subscriptions')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
  await db.exec('SET ROLE service_role');expect(await manage()).toMatchObject({enabled:true});await expect(db.exec("UPDATE browser_push_subscriptions SET enabled=false,ciphertext=NULL")).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('has no retrospective notices and no queue without voluntary enrollment',async()=>{
  await notify();expect(await claims()).toEqual([]);await manage();expect(await claims()).toEqual([]);
 });
 it('queues only metadata and claims once, preserving the bell as unread',async()=>{
  await manage();await notify();const [job]=await claims();expect(job).toMatchObject({notice:{version:1,kind:'mention',conversation_id:conv,locale:'es'}});expect(JSON.stringify(job)).not.toContain('PRIVATE CUSTOMER NOTE');
  expect(await claims()).toEqual([]);expect(await finish(job.id,job.lease_id)).toBe(true);expect(await finish(job.id,job.lease_id)).toBe(false);expect(await scalar('SELECT read_at FROM workspace_notifications')).toBeNull();
 });
 it.each(['removed_member','no_inbox','read','deleted_case','foreign_case','expired','withdrawn','old_notice'])('rechecks %s before claim',async kind=>{
  await manage();await notify();
  if(kind==='removed_member')await db.exec('DELETE FROM workspace_members');
  if(kind==='no_inbox')await db.exec(`UPDATE workspace_members SET allowed_sections='["/contactos"]'`);
  if(kind==='read')await db.exec('UPDATE workspace_notifications SET read_at=now()');
  if(kind==='deleted_case')await db.exec('UPDATE conversations SET deleted_at=now()');
  if(kind==='foreign_case')await db.query('UPDATE conversations SET workspace_id=$1',[other]);
  if(kind==='expired')await db.exec("UPDATE browser_push_subscriptions SET expires_at=now()-interval '1 second'");
  if(kind==='withdrawn')await manage('remove');
  if(kind==='old_notice')await db.exec("UPDATE workspace_notifications SET created_at=now()-interval '11 minutes'");
  expect(await claims()).toEqual([]);expect(await scalar('SELECT state FROM browser_push_receipts')).toBe('dropped');
 });
 it.each(['gmail','outlook','zoho'])('requires current private %s connection ownership',async channel=>{
  await db.query('INSERT INTO channel_connections VALUES($1,$2,$3,$4)',[connection,ws,owner,channel]);await db.query('UPDATE conversations SET channel=$1,connection_id=$2',[channel,connection]);
  await manage();await notify();expect(await claims()).toEqual([]);
 });
 it('checks source workspace and recipient binding after the subscription moves',async()=>{
  await manage();await notify();await manage('save',member,other).catch(()=>{});
  await db.query('UPDATE browser_push_subscriptions SET workspace_id=$1',[other]);expect(await claims()).toEqual([]);
 });
 it('allows only the actual actor to enroll, move or remove a physical endpoint',async()=>{
  await manage();await expect(manage('save',owner)).rejects.toThrow('browser_push_forbidden');await expect(manage('remove',owner)).rejects.toThrow('browser_push_forbidden');
  await db.exec(`UPDATE workspace_members SET allowed_sections='[]'`);await expect(manage()).rejects.toThrow('browser_push_forbidden');expect(await manage('remove')).toEqual({enabled:false});expect(await scalar('SELECT ciphertext FROM browser_push_subscriptions')).toBeNull();
 });
 it('limits active device enrollments and does not let reenrollment bypass the cap',async()=>{
  for(let n=1;n<=5;n++)await manage('save',member,ws,String(n).repeat(64));
  await expect(manage('save',member,ws,'6'.repeat(64))).rejects.toThrow('browser_push_limit');
  expect(await manage('save',member,ws,'1'.repeat(64))).toMatchObject({enabled:true});
 });
 it('makes a lost or uncertain provider acknowledgment nonreplayable',async()=>{
  await manage();await notify();const [job]=await claims();await db.exec("UPDATE browser_push_receipts SET claimed_at=now()-interval '6 minutes'");
  expect(await claims()).toEqual([]);expect(await scalar('SELECT state FROM browser_push_receipts')).toBe('uncertain');expect(await finish(job.id,job.lease_id)).toBe(false);
 });
 it('invalidates expired endpoints only under the correct durable lease',async()=>{
  await manage();await notify();const [job]=await claims();expect(await finish(job.id,other,'dropped',410)).toBe(false);expect(await scalar('SELECT enabled FROM browser_push_subscriptions')).toBe(true);
  expect(await finish(job.id,job.lease_id,'dropped',410)).toBe(true);expect(await scalar('SELECT ciphertext FROM browser_push_subscriptions')).toBeNull();expect(await scalar('SELECT enabled FROM browser_push_subscriptions')).toBe(false);
 });
 it('rejects success without a provider acknowledgment and invalid state/status',async()=>{
  await manage();await notify();const [job]=await claims();
  await expect(finish(job.id,job.lease_id,'acknowledged',null)).rejects.toThrow('invalid_browser_push_context');
  await expect(finish(job.id,job.lease_id,'approved',200)).rejects.toThrow('invalid_browser_push_context');
  await expect(finish(job.id,job.lease_id,'uncertain',900)).rejects.toThrow('invalid_browser_push_context');
  expect(await finish(job.id,job.lease_id,'uncertain',null)).toBe(true);
 });
});
