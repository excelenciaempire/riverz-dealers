import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='22222222-2222-4222-8222-222222222222',teammate='33333333-3333-4333-8333-333333333333',conversation='44444444-4444-4444-8444-444444444444',message='55555555-5555-4555-8555-555555555555',agent='66666666-6666-4666-8666-666666666666',rule='77777777-7777-4777-8777-777777777777',id='88888888-8888-4888-8888-888888888888'
const evidence={ version:1,rules:[{ id:rule,revision:1,title:'Confirmed dates' }],sources:[{ kind:'message',id:message }],tools:[{ name:'lookup_order',kind:'local',status:'returned',sequence:1 }],truncated:false }
beforeAll(async() => {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
 CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE);CREATE TABLE agent_guidance(id uuid PRIMARY KEY,workspace_id uuid);CREATE TABLE guidance_live_versions(rule_id uuid,workspace_id uuid);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid);CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,sender_type text,deleted_at timestamptz);CREATE TABLE shopify_products(id uuid PRIMARY KEY,workspace_id uuid);
 GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT ON conversations,channel_connections,workspace_members TO authenticated;`)
 const sql=readFileSync('supabase/migrations/316_ai_turn_evidence.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users,channel_connections,agent_guidance,guidance_live_versions,shopify_products CASCADE;SELECT set_config('request.jwt.claim.sub','',false)")
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,teammate]);await db.query('INSERT INTO workspace_members VALUES($1,$2),($1,$3)',[ws,actor,teammate]);await db.query('INSERT INTO ai_agents VALUES($1,$2)',[agent,ws]);await db.query('INSERT INTO agent_guidance VALUES($1,$2)',[rule,ws]);await db.query('INSERT INTO channel_connections VALUES($1,$2,$3)',[agent,ws,actor]);await db.query("INSERT INTO conversations VALUES($1,$2,'gmail',$3,NULL)",[conversation,ws,agent]);await db.query("INSERT INTO messages VALUES($1,$2,'customer',NULL)",[message,conversation])
})
const record=(body:unknown=evidence,workspace=ws,status='failed',outputs:string[]=[]) => db.query('SELECT record_ai_turn_evidence($1,$2,$3,$4,NULL,ARRAY(SELECT jsonb_array_elements_text($8::jsonb))::uuid[],$5,$6,NULL,$7)',[id,workspace,conversation,message,agent,status,JSON.stringify(body),JSON.stringify(outputs)])
describe('private immutable AI turn observations',() => {
 it('records real observations once, without converting returned tools into completed actions',async() => {
  await record();await record();expect((await db.query('SELECT status,evidence FROM ai_turn_evidence')).rows).toEqual([{ status:'failed',evidence }])
  await expect(record(evidence,ws,'sent')).rejects.toThrow('ai_evidence_conflict')
 })
 it('records references from the existing Shopify catalogue table only in the same workspace',async() => {
  const body={ ...evidence,sources:[{ kind:'catalogue',id:rule,title:'Existing catalogue entry' }] }
  await db.query('INSERT INTO shopify_products VALUES($1,$2)',[rule,ws]);await record(body)
  await db.exec('DELETE FROM ai_turn_evidence');await db.query('UPDATE shopify_products SET workspace_id=$1',[other]);await expect(record(body)).rejects.toThrow('invalid_ai_evidence')
 })
 it('rejects foreign cases, sources, rules and raw tool payloads',async() => {
  await expect(record(evidence,other)).rejects.toThrow('invalid_ai_evidence')
  await db.query('UPDATE agent_guidance SET workspace_id=$1',[other]);await expect(record()).rejects.toThrow('invalid_ai_evidence');await db.query('UPDATE agent_guidance SET workspace_id=$1',[ws])
  await expect(record({ ...evidence,tools:[{ ...evidence.tools[0],arguments:{ token:'private' } }] })).rejects.toThrow('invalid_ai_evidence')
  await expect(record({ ...evidence,sources:[{ kind:'catalogue',id:rule,title:'Foreign' }] })).rejects.toThrow('invalid_ai_evidence')
  await expect(record({ ...evidence,tools:[{ name:'lookup_order',sequence:1 }] })).rejects.toThrow('invalid_ai_evidence')
 })
 it('hides private mailbox evidence from another teammate and after ownership revocation',async() => {
  await record();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM ai_turn_evidence')).rows).toHaveLength(1)
  await db.exec('RESET ROLE');await db.query('UPDATE channel_connections SET created_by=$1',[teammate]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM ai_turn_evidence')).rows).toHaveLength(0)
 })
 it('counts distinct accessible cases and observed failures without attributing application or resolution',async() => {
  await record();await db.query("INSERT INTO ai_turn_evidence SELECT gen_random_uuid(),workspace_id,conversation_id,inbound_message_id,message_id,message_ids,agent_id,'sent',NULL,evidence,created_at FROM ai_turn_evidence")
  const metric=async(user:string) => (await db.query<{ value:{ recorded_turns:number;distinct_cases:number;failed_turns:number;attribution:string } }>('SELECT ai_rule_context_metrics($1,$2,$3) AS value',[ws,rule,user])).rows[0].value
  expect(await metric(actor)).toMatchObject({ recorded_turns:2,distinct_cases:1,failed_turns:1,attribution:'context_only' })
  expect(await metric(teammate)).toMatchObject({ recorded_turns:0,distinct_cases:0 })
  await db.query('DELETE FROM workspace_members WHERE user_id=$1',[actor]);await expect(metric(actor)).rejects.toThrow('invalid_ai_evidence')
 })
 it('retains observed versions when rules are removed and erases evidence with the case',async() => {
  await db.query('INSERT INTO guidance_live_versions VALUES($1,$2)',[rule,ws]);await db.query('DELETE FROM agent_guidance WHERE id=$1',[rule]);await record()
  await db.query('DELETE FROM ai_agents WHERE id=$1',[agent]);expect((await db.query('SELECT agent_id FROM ai_turn_evidence')).rows).toEqual([{ agent_id:null }])
  await db.query('DELETE FROM conversations WHERE id=$1',[conversation]);expect((await db.query('SELECT * FROM ai_turn_evidence')).rows).toHaveLength(0)
 })
 it('links every actual output chunk and rejects customer or foreign-message links',async() => {
  const one='99999999-9999-4999-8999-999999999999',two='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await db.query("INSERT INTO messages VALUES($1,$3,'bot',NULL),($2,$3,'bot',NULL)",[one,two,conversation])
  await record(evidence,ws,'sent',[one,two]);expect((await db.query('SELECT message_ids FROM ai_turn_evidence')).rows).toEqual([{ message_ids:[one,two] }])
  await db.exec('DELETE FROM ai_turn_evidence');await expect(record(evidence,ws,'sent',[message])).rejects.toThrow('invalid_ai_evidence')
 })
 it('permits authenticated reads only, never forged evidence or direct RPC calls',async() => {
  expect((await db.query("SELECT has_table_privilege('authenticated','ai_turn_evidence','insert') AS write,has_function_privilege('authenticated','record_ai_turn_evidence(uuid,uuid,uuid,uuid,uuid,uuid[],uuid,text,text,jsonb)','execute') AS rpc")).rows).toEqual([{ write:false,rpc:false }])
 })
})
