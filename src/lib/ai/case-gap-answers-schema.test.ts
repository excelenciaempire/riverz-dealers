import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='22222222-2222-4222-8222-222222222222',member='33333333-3333-4333-8333-333333333333',conversation='44444444-4444-4444-8444-444444444444',gap='55555555-5555-4555-8555-555555555555',connection='66666666-6666-4666-8666-666666666666',receipt='77777777-7777-4777-8777-777777777777',second='88888888-8888-4888-8888-888888888888'
beforeAll(async() => {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text);
 CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE);
 CREATE TABLE agent_guidance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,agent_id uuid REFERENCES ai_agents(id),titulo text NOT NULL,cuando text,hacer text NOT NULL,activa boolean NOT NULL DEFAULT true,orden integer DEFAULT 0,origen text DEFAULT 'comercio',clave text,updated_at timestamptz DEFAULT now(),UNIQUE(workspace_id,clave));
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE answer_gaps(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,channel text,question text,question_key text,missing text,resolved_at timestamptz,resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,created_at timestamptz DEFAULT now());ALTER TABLE answer_gaps ENABLE ROW LEVEL SECURITY;
 CREATE TABLE shopify_products(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,title text,custom_faqs jsonb,training_material text,description text);
 GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT ON workspace_members,conversations,channel_connections TO authenticated;`)
 await db.exec(readFileSync('supabase/migrations/313_guidance_versions.sql','utf8'))
 await db.exec(readFileSync('supabase/migrations/317_gap_knowledge_reviews.sql','utf8'));const sql=readFileSync('supabase/migrations/318_case_gap_answers.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users,channel_connections CASCADE;UPDATE billing SET allowed=true;SELECT set_config('request.jwt.claim.sub','',false)")
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,member])
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent')",[ws,owner,member])
 await db.query('INSERT INTO channel_connections VALUES($1,$2,$3)',[connection,ws,owner])
 await db.query("INSERT INTO conversations VALUES($1,$2,'gmail',$3,NULL)",[conversation,ws,connection])
 await db.query("INSERT INTO answer_gaps(id,workspace_id,conversation_id,channel,question,question_key) VALUES($1,$2,$3,'gmail','Delivery?','delivery')",[gap,ws,conversation])
})
const save=(id=receipt,revision=0,answer='Only this case',actor=owner,workspace=ws,source=gap,caseId=conversation) => db.query<{ result:{ ok:boolean;replayed:boolean;revision:number;scope:string } }>('SELECT save_case_gap_answer($1,$2,$3,$4,$5,$6,$7) AS result',[id,workspace,actor,caseId,source,revision,answer])
const list=(actor=owner,workspace=ws,caseId=conversation) => db.query('SELECT * FROM list_case_gap_answers($1,$2,$3)',[workspace,actor,caseId])
describe('durable internal answers with strict case scope',() => {
 it('uses the existing unanswered source, recording the author without changing policy, handoff or gap state',async() => {
  expect((await list()).rows[0]).toMatchObject({ gap_id:gap,answer:null,revision:0 })
  expect((await save()).rows[0].result).toMatchObject({ ok:true,scope:'case_only',revision:1,replayed:false })
  expect((await list()).rows[0]).toMatchObject({ gap_id:gap,answer:'Only this case',revision:1,answered_by:owner,resolved_at:null })
  expect((await db.query('SELECT * FROM agent_guidance')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM shopify_products')).rows).toHaveLength(0)
 })
 it('replays only the identical receipt, even in read-only mode, without duplicating or changing the author',async() => {
  await save();await db.exec('UPDATE billing SET allowed=false');expect((await save()).rows[0].result.replayed).toBe(true)
  await expect(save(receipt,0,'Different')).rejects.toThrow('gap_changed');expect((await db.query('SELECT * FROM case_gap_answers')).rows).toHaveLength(1)
 })
 it('keeps editable versions and rejects stale edits instead of overwriting the team',async() => {
  await save();await save(second,1,'Updated for this customer')
  await expect(save('99999999-9999-4999-8999-999999999999',1,'Stale')).rejects.toThrow('gap_changed')
  expect((await list()).rows[0]).toMatchObject({ revision:2,answer:'Updated for this customer' });expect((await db.query('SELECT revision,answer FROM case_gap_answers ORDER BY revision')).rows).toEqual([{ revision:1,answer:'Only this case' },{ revision:2,answer:'Updated for this customer' }])
 })
 it('enforces personal mailbox access on list, save and authenticated RLS',async() => {
  await expect(list(member)).rejects.toThrow('invalid_gap_context');await expect(save(receipt,0,'Hidden',member)).rejects.toThrow('invalid_gap_context');await save()
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM case_gap_answers')).rows).toHaveLength(0)
  await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM case_gap_answers')).rows).toHaveLength(1)
 })
 it('rechecks current membership, mailbox ownership and case deletion before returning or replaying',async() => {
  await save();await db.exec(`UPDATE channel_connections SET created_by='${member}'`);await expect(save()).rejects.toThrow('invalid_gap_context');await expect(list()).rejects.toThrow('invalid_gap_context')
  await db.exec(`UPDATE channel_connections SET created_by='${owner}';DELETE FROM workspace_members WHERE user_id='${owner}'`);await expect(save()).rejects.toThrow('invalid_gap_context')
 })
 it('does not turn erased cases into unbound knowledge and deletes their answer history',async() => {
  await save();await db.exec('UPDATE conversations SET deleted_at=now()');await expect(list()).rejects.toThrow('invalid_gap_context');await expect(save()).rejects.toThrow('invalid_gap_context')
  await db.query('DELETE FROM conversations WHERE id=$1',[conversation]);expect((await db.query('SELECT * FROM case_gap_answers')).rows).toHaveLength(0)
 })
 it('rejects foreign workspaces, source gaps and conversation ids',async() => {
  await expect(save(receipt,0,'Cross workspace',owner,other)).rejects.toThrow('invalid_gap_context')
  await expect(save(receipt,0,'Cross case',owner,ws,gap,second)).rejects.toThrow('invalid_gap_context')
  await expect(save(receipt,0,'Missing source',owner,ws,second)).rejects.toThrow('invalid_gap_context')
  await expect(list(owner,other)).rejects.toThrow('invalid_gap_context')
 })
 it('permits a current teammate in shared channels but does not allow replaying another author’s receipt',async() => {
  await db.exec("UPDATE conversations SET channel='whatsapp';UPDATE answer_gaps SET channel='whatsapp'");await save();await expect(save(receipt,0,'Only this case',member)).rejects.toThrow('gap_changed');await save(second,1,'Team update',member)
  expect((await list(member)).rows[0]).toMatchObject({ revision:2,answered_by:member })
 })
 it('prevents new answers while read-only or after a gap was resolved; old receipts remain readable',async() => {
  await db.exec('UPDATE billing SET allowed=false');await expect(save()).rejects.toThrow('subscription_read_only');await db.exec('UPDATE billing SET allowed=true');await save()
  await db.exec('UPDATE answer_gaps SET resolved_at=now()');expect((await save()).rows[0].result.replayed).toBe(true);await expect(save(second,1,'Late edit')).rejects.toThrow('gap_changed')
 })
 it('denies client writes and mutating RPCs, and removes the author identity on deletion',async() => {
  expect((await db.query("SELECT has_table_privilege('authenticated','case_gap_answers','insert') AS direct_write,has_function_privilege('authenticated','save_case_gap_answer(uuid,uuid,uuid,uuid,uuid,integer,text)','execute') AS rpc,has_function_privilege('anon','list_case_gap_answers(uuid,uuid,uuid)','execute') AS anonymous_read")).rows).toEqual([{ direct_write:false,rpc:false,anonymous_read:false }])
  await save();await db.query('DELETE FROM auth.users WHERE id=$1',[owner]);expect((await db.query('SELECT actor_id FROM case_gap_answers')).rows).toEqual([{ actor_id:null }]);await db.query('DELETE FROM workspaces WHERE id=$1',[ws]);expect((await db.query('SELECT * FROM case_gap_answers')).rows).toHaveLength(0)
 })
})
