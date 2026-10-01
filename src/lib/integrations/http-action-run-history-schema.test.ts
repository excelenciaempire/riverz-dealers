import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {httpRunHistory} from './http-action-run-history-contract';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',action='33333333-3333-4333-8333-333333333333';
const admin='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555',conv='66666666-6666-4666-8666-666666666666',connection='77777777-7777-4777-8777-777777777777';
const uuid=(n:number)=>'88888888-8888-4888-8888-'+String(n).padStart(12,'0');
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE http_actions(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid,channel text);
 CREATE TABLE http_action_runs(id uuid PRIMARY KEY,workspace_id uuid,action_id uuid,action_revision integer,state text,status_code integer,error_code text,created_at timestamptz,finished_at timestamptz,conversation_id uuid,result jsonb,lease_id uuid,input_hash text);
 ALTER TABLE http_action_runs ENABLE ROW LEVEL SECURITY;REVOKE ALL ON http_action_runs FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT ON http_action_runs TO service_role;`);
 await db.exec(readFileSync('supabase/migrations/349_http_action_run_history.sql','utf8'));
},30_000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE http_action_runs,http_actions,workspace_members,workspaces,conversations,channel_connections');
 await db.query('INSERT INTO workspaces VALUES($1,$2,NULL),($3,$3,NULL)',[ws,owner,other]);
 await db.query('INSERT INTO http_actions VALUES($1,$2),($3,$3)',[action,ws,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)",[ws,admin]);
});
async function insert(n:number,conversation:string|null=null,scope=ws,target=action){
 await db.query("INSERT INTO http_action_runs VALUES($1,$2,$3,2,'uncertain',NULL,'http_timeout','2026-10-01T12:00:00.123456Z',NULL,$4,'{\"PRIVATE\":true}',$1,'PRIVATE_HASH')",[uuid(n),scope,target,conversation]);
}
async function read(actor=owner,cursor:{created_at:string;id:string}|null=null){
 const {rows}=await db.query<{data:unknown}>('SELECT read_http_action_runs($1,$2,$3,$4,$5) AS data',[ws,actor,action,cursor?.created_at??null,cursor?.id??null]);return httpRunHistory.parse(rows[0].data);
}
async function count(){return (await db.query<{n:number}>('SELECT count(*)::integer AS n FROM http_action_runs')).rows[0].n;}
describe('Current private visibility for bounded integration receipt history',()=>{
 it('keeps reads private and does not alter states, leases or results',async()=>{
  await insert(1);expect((await db.query<{ready:boolean}>('SELECT http_action_run_history_ready() AS ready')).rows[0].ready).toBe(true);
  const before=await db.query('SELECT * FROM http_action_runs');const data=await read();expect(data.runs).toHaveLength(1);
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE|lease|hash|result|conversation/);expect(await db.query('SELECT * FROM http_action_runs')).toEqual(before);
  for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await expect(read()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
  await db.exec('SET ROLE service_role');expect((await read()).runs).toHaveLength(1);await expect(db.exec("UPDATE http_action_runs SET state='acknowledged'")).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('filters workspace and selected action before ordering or paging',async()=>{
  await insert(1);await insert(2,null,other,other);await insert(3,null,ws,other);expect((await read()).runs.map(row=>row.id)).toEqual([uuid(1)]);expect(await count()).toBe(3);
 });
 it('uses keyset pagination with stable microseconds and tied UUID ordering',async()=>{
  for(let n=1;n<=25;n++)await insert(n);
  const first=await read();expect(first.runs).toHaveLength(20);expect(first.runs[0].id).toBe(uuid(25));expect(first.next_cursor?.id).toBe(uuid(6));expect(first.next_cursor?.created_at).toContain('123456');
  const second=await read(owner,first.next_cursor);expect(second.runs.map(row=>row.id)).toEqual([5,4,3,2,1].map(uuid));expect(second.next_cursor).toBeNull();
 });
 it.each(['agent','removed','settings_missing','automations_missing','malformed_sections'])('rechecks current permission: %s',async kind=>{
  await insert(1);
  if(kind==='agent')await db.query("UPDATE workspace_members SET role='agent'");
  if(kind==='removed')await db.exec('DELETE FROM workspace_members');
  if(kind==='settings_missing')await db.exec(`UPDATE workspace_members SET allowed_sections='["/automatizaciones"]'`);
  if(kind==='automations_missing')await db.exec(`UPDATE workspace_members SET allowed_sections='["/ajustes"]'`);
  if(kind==='malformed_sections')await db.exec(`UPDATE workspace_members SET allowed_sections='{}'`);
  await expect(read(admin)).rejects.toThrow('http_action_admin_required');expect(await count()).toBe(1);
 });
 it('allows business receipts while hiding case receipts without Inbox access',async()=>{
  await db.exec(`UPDATE workspace_members SET allowed_sections='["/ajustes","/automatizaciones"]'`);
  await db.query("INSERT INTO conversations VALUES($1,$2,'whatsapp',NULL,NULL)",[conv,ws]);await insert(1);await insert(2,conv);
  expect((await read(admin)).runs.map(row=>row.id)).toEqual([uuid(1)]);expect((await read(owner)).runs).toHaveLength(2);
 });
 it('hides deleted and foreign conversation bindings',async()=>{
  await db.query("INSERT INTO conversations VALUES($1,$2,'whatsapp',NULL,NULL)",[conv,other]);await insert(1,conv);expect((await read()).runs).toHaveLength(0);
  await db.query('UPDATE conversations SET workspace_id=$1,deleted_at=now()',[ws]);expect((await read()).runs).toHaveLength(0);
 });
 it.each(['gmail','outlook','zoho'])('protects mailbox %s even from another business administrator',async channel=>{
  await db.query('INSERT INTO channel_connections VALUES($1,$2,$3,$4)',[connection,ws,admin,channel]);await db.query('INSERT INTO conversations VALUES($1,$2,$3,$4,NULL)',[conv,ws,channel,connection]);await insert(1,conv);
  expect((await read()).runs).toHaveLength(0);expect((await read(admin)).runs).toHaveLength(1);
  await db.query('UPDATE channel_connections SET workspace_id=$1',[other]);expect((await read(admin)).runs).toHaveLength(0);
 });
 it('redacts unexpected errors instead of returning free text',async()=>{
  await insert(1);await db.exec("UPDATE http_action_runs SET error_code='PRIVATE_ACCOUNT_TOKEN'");expect((await read()).runs[0].error_code).toBe('http_execution_unavailable');
 });
 it('rejects absent/deleted workspace, absent action and unpaired cursor without mutation',async()=>{
  await insert(1);await expect(db.query('SELECT read_http_action_runs(NULL,$1,$2)',[owner,action])).rejects.toThrow('invalid_http_action_context');
  await expect(db.query('SELECT read_http_action_runs($1,$2,$3,now(),NULL)',[ws,owner,action])).rejects.toThrow('invalid_http_action_context');
  await db.exec('DELETE FROM http_actions');await expect(read()).rejects.toThrow('invalid_http_action_context');
  await db.query('INSERT INTO http_actions VALUES($1,$2)',[action,ws]);await db.exec('UPDATE workspaces SET deleted_at=now()');await expect(read()).rejects.toThrow('invalid_http_action_context');expect(await count()).toBe(1);
 });
});
