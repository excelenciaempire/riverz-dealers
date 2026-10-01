import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333';
const conversation='44444444-4444-4444-8444-444444444444',message='55555555-5555-4555-8555-555555555555',document='66666666-6666-4666-8666-666666666666',id='77777777-7777-4777-8777-777777777777',other='88888888-8888-4888-8888-888888888888';
const source={kind:'document',id:document,revision:3,title:'Reviewed policy'};
const body=(sources:unknown[])=>({version:1,rules:[],sources,tools:[],truncated:false});
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid,user_id uuid);
 CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid())$$;
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id));
 CREATE TABLE agent_guidance(id uuid PRIMARY KEY,workspace_id uuid);CREATE TABLE guidance_live_versions(rule_id uuid,workspace_id uuid);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),sender_type text,deleted_at timestamptz);
 CREATE TABLE shopify_products(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE case_gap_answers(id uuid PRIMARY KEY,workspace_id uuid,conversation_id uuid,question_snapshot text);
 CREATE TABLE ai_document_source_versions(source_id uuid,revision integer,workspace_id uuid,agent_id uuid,status text,PRIMARY KEY(source_id,revision));
 ALTER TABLE ai_document_source_versions ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON ai_document_source_versions FROM PUBLIC,anon,authenticated,service_role;
 GRANT SELECT ON ai_document_source_versions TO authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/316_ai_turn_evidence.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/348_ai_document_turn_evidence.sql','utf8'));
},30_000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec("RESET ROLE;TRUNCATE ai_turn_evidence,ai_document_source_versions,case_gap_answers,shopify_products,messages,conversations,ai_agents,workspace_members,workspaces,auth.users CASCADE");
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1)',[actor]);
 await db.query('INSERT INTO workspace_members VALUES($1,$2)',[ws,actor]);await db.query('INSERT INTO ai_agents VALUES($1,$2)',[agent,ws]);
 await db.query("INSERT INTO conversations VALUES($1,$2,'whatsapp',NULL,NULL)",[conversation,ws]);await db.query("INSERT INTO messages VALUES($1,$2,'customer',NULL)",[message,conversation]);
 await db.query("INSERT INTO ai_document_source_versions VALUES($1,3,$2,$3,'active')",[document,ws,agent]);
});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const record=(sources:unknown[]=[source],assistant:string|null=agent)=>scalar('SELECT record_ai_turn_evidence($1,$2,$3,$4,NULL,ARRAY[]::uuid[],$5,\'unknown\',NULL,$6)',[id,ws,conversation,message,assistant,body(sources)]);
describe('Historical documentary context uses an exact private version',()=>{
 it('records an active reviewed version idempotently with private function permissions',async()=>{
  expect(await scalar('SELECT ai_document_turn_evidence_ready()')).toBe(true);expect(await record()).toBe(id);expect(await record()).toBe(id);
  expect(await scalar('SELECT count(*) FROM ai_turn_evidence')).toBe(1);await db.exec('SET ROLE authenticated');await expect(record()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it.each(['workspace','agent','draft','withdrawn','missing_version'])('rejects %s documentary provenance',async kind=>{
  if(kind==='workspace')await db.query('UPDATE ai_document_source_versions SET workspace_id=$1',[other]);
  if(kind==='agent')await db.query('UPDATE ai_document_source_versions SET agent_id=$1',[other]);
  if(kind==='draft'||kind==='withdrawn')await db.query('UPDATE ai_document_source_versions SET status=$1',[kind]);
  await expect(record(kind==='missing_version'?[{...source,revision:4}]:[source])).rejects.toThrow('invalid_ai_evidence');
  expect(await scalar('SELECT count(*) FROM ai_turn_evidence')).toBe(0);
 });
 it.each([0,-1,1.5,2147483648,null,'3',undefined])('rejects an invalid version %s',async revision=>{
  await expect(record([{...source,revision}])).rejects.toThrow();expect(await scalar('SELECT count(*) FROM ai_turn_evidence')).toBe(0);
 });
 it('does not infer the assistant identity from the document',async()=>{
  await expect(record([source],null)).rejects.toThrow('invalid_ai_evidence');
 });
 it('preserves a genuinely prepared historical active version after a later withdrawal',async()=>{
  await db.query("INSERT INTO ai_document_source_versions VALUES($1,4,$2,$3,'withdrawn')",[document,ws,agent]);expect(await record()).toBe(id);
 });
 it('keeps existing case-answer, customer-message and catalogue validation',async()=>{
  await db.query('INSERT INTO case_gap_answers VALUES($1,$2,$3,$4)',[other,ws,conversation,'Reviewed question']);await db.query('INSERT INTO shopify_products VALUES($1,$2)',[document,ws]);
  expect(await record([source,{kind:'case_answer',id:other},{kind:'message',id:message},{kind:'catalogue',id:document}])).toBe(id);
  await db.exec('DELETE FROM ai_turn_evidence');await db.query('UPDATE case_gap_answers SET conversation_id=$1',[other]);
  await expect(record([{kind:'case_answer',id:other}])).rejects.toThrow('invalid_ai_evidence');
 });
 it('rejects invented version metadata on other source kinds and raw document text',async()=>{
  await expect(record([{kind:'message',id:message,revision:3}])).rejects.toThrow('invalid_ai_evidence');
  await expect(record([{...source,text:'Untrusted document body'}])).rejects.toThrow('invalid_ai_evidence');
 });
 it('never rewrites an earlier turn to claim a different prepared version',async()=>{
  await record();await db.query("INSERT INTO ai_document_source_versions VALUES($1,4,$2,$3,'active')",[document,ws,agent]);
  await expect(record([{...source,revision:4}])).rejects.toThrow('ai_evidence_conflict');
 });
});
