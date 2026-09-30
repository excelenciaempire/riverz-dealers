import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',teammate='33333333-3333-4333-8333-333333333333',rule='44444444-4444-4444-8444-444444444444',agent='55555555-5555-4555-8555-555555555555',conversation='66666666-6666-4666-8666-666666666666',connection='77777777-7777-4777-8777-777777777777'
const now='2026-09-30T00:00:00Z',result={ applies:true,reply:'Please confirm your order.',summary:'Needs an order reference.',conflicts:[] }
beforeAll(async() => {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
 CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,is_active boolean,updated_at timestamptz);
 CREATE TABLE agent_guidance(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,agent_id uuid,live_revision integer,activa boolean);
 CREATE TABLE guidance_drafts(rule_id uuid PRIMARY KEY REFERENCES agent_guidance(id) ON DELETE CASCADE,workspace_id uuid,base_revision integer,draft_revision integer,state text);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid);CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT ON conversations,channel_connections,workspace_members TO authenticated;`)
 const sql=readFileSync('supabase/migrations/314_guidance_replays.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users,channel_connections CASCADE;UPDATE billing SET allowed=true;SELECT set_config('request.jwt.claim.sub','',false)")
 await db.query('INSERT INTO workspaces VALUES($1)',[ws]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,teammate]);await db.query('INSERT INTO workspace_members VALUES($1,$2),($1,$3)',[ws,actor,teammate]);await db.query('INSERT INTO ai_agents VALUES($1,$2,true,$3)',[agent,ws,now]);await db.query('INSERT INTO agent_guidance VALUES($1,$2,NULL,1,true)',[rule,ws]);await db.query("INSERT INTO guidance_drafts VALUES($1,$2,1,1,'draft')",[rule,ws]);await db.query('INSERT INTO channel_connections VALUES($1,$2,$3)',[connection,ws,actor]);await db.query("INSERT INTO conversations VALUES($1,$2,'gmail',$3,NULL)",[conversation,ws,connection])
})
const record=(draft=1,user=actor,revision=1,peers:unknown=[],body:unknown=result,source:unknown={ count:1,hash:'f'.repeat(64),truncated:false,through_customer_turn:true,observed_at:now }) => db.query('SELECT record_guidance_test(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[ws,rule,conversation,user,revision,draft,agent,now,JSON.stringify(peers),JSON.stringify(source),JSON.stringify(body)])
describe('private rule test receipts',() => {
 it('records the exact tested version without changing the live rule',async() => {
  await record();expect((await db.query('SELECT live_revision,activa FROM agent_guidance')).rows).toEqual([{ live_revision:1,activa:true }]);expect((await db.query('SELECT state FROM guidance_drafts')).rows).toEqual([{ state:'test' }])
  expect((await db.query('SELECT live_revision,draft_revision,result FROM guidance_test_runs')).rows).toEqual([{ live_revision:1,draft_revision:1,result }])
 })
 it('rejects stale rule, draft, assistant and peer changes instead of certifying another policy',async() => {
  await expect(record(1,actor,2)).rejects.toThrow('guidance_changed');await expect(record(2)).rejects.toThrow('guidance_changed')
  await db.query("UPDATE ai_agents SET updated_at=$1",['2026-10-01T00:00:00Z']);await expect(record()).rejects.toThrow('guidance_changed');await db.query('UPDATE ai_agents SET updated_at=$1',[now])
  await db.exec("INSERT INTO agent_guidance VALUES(gen_random_uuid(),'11111111-1111-4111-8111-111111111111',NULL,1,true)");await expect(record()).rejects.toThrow('guidance_changed')
  expect((await db.query('SELECT * FROM guidance_test_runs')).rows).toHaveLength(0)
 })
 it('denies private mailbox use by another teammate and hides receipts after owner change',async() => {
  await expect(record(1,teammate)).rejects.toThrow('invalid_guidance_context');await record()
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM guidance_test_runs')).rows).toHaveLength(1)
  await db.exec('RESET ROLE');await db.query('UPDATE channel_connections SET created_by=$1',[teammate]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM guidance_test_runs')).rows).toHaveLength(0)
 })
 it('hides receipts after membership revocation or case deletion and enforces read-only billing',async() => {
  await db.exec('UPDATE billing SET allowed=false');await expect(record()).rejects.toThrow('subscription_read_only');await db.exec('UPDATE billing SET allowed=true');await record()
  await db.query('DELETE FROM workspace_members WHERE user_id=$1',[actor]);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM guidance_test_runs')).rows).toHaveLength(0)
  await db.exec('RESET ROLE');await db.query('DELETE FROM conversations WHERE id=$1',[conversation]);expect((await db.query('SELECT * FROM guidance_test_runs')).rows).toHaveLength(0)
 })
 it('retains receipts when a rule or author is deleted without granting client writes',async() => {
  await record();await db.query('DELETE FROM auth.users WHERE id=$1',[actor]);await db.query('DELETE FROM agent_guidance WHERE id=$1',[rule])
  expect((await db.query('SELECT actor_id,rule_id,rule_ref FROM guidance_test_runs')).rows).toEqual([{ actor_id:null,rule_id:null,rule_ref:rule }])
  expect((await db.query("SELECT has_table_privilege('authenticated','guidance_test_runs','insert') AS write,has_function_privilege('authenticated','record_guidance_test(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,timestamptz,jsonb,jsonb,jsonb)','execute') AS rpc")).rows).toEqual([{ write:false,rpc:false }])
 })
 it('rejects private reasoning or malformed model output at the database boundary',async() => {
  await expect(record(1,actor,1,[],{ ...result,reasoning:'Do not publish' })).rejects.toThrow('invalid_guidance_test')
  await expect(record(1,actor,1,[],{ ...result,reply:'x'.repeat(4001) })).rejects.toThrow('invalid_guidance_test')
  await expect(record(1,actor,1,[],{ ...result,conflicts:[{ rule_id:agent,reason:'Unknown rule' }] })).rejects.toThrow('invalid_guidance_test')
  await expect(record(1,actor,1,[],result,{ count:1,hash:'f'.repeat(64),raw_conversation:'Must not persist' })).rejects.toThrow('invalid_guidance_test')
 })
})
