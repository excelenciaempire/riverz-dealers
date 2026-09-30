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
 await db.exec(`ALTER TABLE ai_agents ADD COLUMN is_active boolean DEFAULT true;CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,sender_type text,deleted_at timestamptz);`);await db.exec(readFileSync('supabase/migrations/316_ai_turn_evidence.sql','utf8'));const context=readFileSync('supabase/migrations/320_case_gap_model_context.sql','utf8');await db.exec(context);await db.exec(context)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users,channel_connections CASCADE;UPDATE billing SET allowed=true;SELECT set_config('request.jwt.claim.sub','',false)")
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,member])
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent')",[ws,owner,member])
 await db.query('INSERT INTO ai_agents(id,workspace_id) VALUES($1,$2)',[connection,ws]);await db.query('INSERT INTO channel_connections VALUES($1,$2,$3)',[connection,ws,owner])
 await db.query("INSERT INTO conversations VALUES($1,$2,'gmail',$3,NULL)",[conversation,ws,connection])
 await db.query("INSERT INTO answer_gaps(id,workspace_id,conversation_id,channel,question,question_key) VALUES($1,$2,$3,'gmail','Delivery?','delivery')",[gap,ws,conversation])
})
const save=(id=receipt,revision=0,answer='Only this case') => db.query('SELECT save_case_gap_answer($1,$2,$3,$4,$5,$6,$7)',[id,ws,owner,conversation,gap,revision,answer])
const context=(workspace=ws,caseId=conversation,agent=connection) => db.query('SELECT * FROM load_case_gap_model_context($1,$2,$3)',[workspace,caseId,agent])
const evidence={ version:1,rules:[],sources:[{ kind:'case_answer',id:receipt,title:'Delivery?' }],tools:[],truncated:false }
const record=(body:unknown=evidence,caseId=conversation) => db.query('SELECT record_ai_turn_evidence($1,$2,$3,NULL,NULL,ARRAY[]::uuid[],$4,$5,NULL,$6)',[second,ws,caseId,connection,'sent',JSON.stringify(body)])
describe('current case answer snapshots and source evidence',() => {
 it('captures the actual question once and prepares only the latest full answer version from this case',async() => {
  await save();await save(second,1,'Revised exception');expect((await context()).rows).toMatchObject([{ id:second,question:'Delivery?',answer:'Revised exception',revision:2,actor_id:owner }])
  expect((await db.query('SELECT question_snapshot FROM case_gap_answers ORDER BY revision')).rows).toEqual([{ question_snapshot:'Delivery?' },{ question_snapshot:'Delivery?' }])
 })
 it('keeps versions immutable and prevents a source question from being silently changed',async() => {
  await save();await expect(db.exec("UPDATE case_gap_answers SET answer='Altered'" )).rejects.toThrow('invalid_gap_context');await expect(db.exec("UPDATE answer_gaps SET question='Different?'" )).rejects.toThrow('invalid_gap_context')
  await db.query('DELETE FROM auth.users WHERE id=$1',[owner]);expect((await db.query('SELECT actor_id FROM case_gap_answers')).rows).toEqual([{ actor_id:null }])
 })
 it('does not invent snapshots or teach the model from older unsnapshotted versions',async() => {
  await db.exec('ALTER TABLE case_gap_answers DISABLE TRIGGER case_gap_answer_snapshot_before');await db.query('INSERT INTO case_gap_answers(id,workspace_id,conversation_id,gap_id,revision,answer,actor_id) VALUES($1,$2,$3,$4,1,$5,$6)',[receipt,ws,conversation,gap,'Historical answer',owner]);await db.exec('ALTER TABLE case_gap_answers ENABLE TRIGGER case_gap_answer_snapshot_before');expect((await context()).rows).toHaveLength(0)
  await expect(record()).rejects.toThrow('invalid_ai_evidence')
 })
 it('rejects inactive/foreign agents, foreign cases and private mailboxes whose owner left the business',async() => {
  await save();await expect(context(other)).rejects.toThrow('invalid_gap_context');await expect(context(ws,second)).rejects.toThrow('invalid_gap_context');await expect(context(ws,conversation,second)).rejects.toThrow('invalid_gap_context')
  await db.exec('UPDATE ai_agents SET is_active=false');await expect(context()).rejects.toThrow('invalid_gap_context');await db.exec('UPDATE ai_agents SET is_active=true');await db.query('DELETE FROM workspace_members WHERE user_id=$1',[owner]);await expect(context()).rejects.toThrow('invalid_gap_context')
 })
 it('never transfers an answer to another case or revives a deleted case',async() => {
  await save();await db.query("INSERT INTO conversations VALUES($1,$2,'whatsapp',NULL,NULL)",[second,ws]);expect((await context(ws,second)).rows).toHaveLength(0);await db.exec('UPDATE conversations SET deleted_at=now()');await expect(context()).rejects.toThrow('invalid_gap_context')
 })
 it('records the exact immutable answer source under the same business and case, alongside the existing evidence contract',async() => {
  await save();await record();expect((await db.query('SELECT evidence FROM ai_turn_evidence')).rows).toEqual([{ evidence }])
  await db.exec('DELETE FROM ai_turn_evidence');await db.query("INSERT INTO conversations VALUES($1,$2,'whatsapp',NULL,NULL)",[second,ws]);await expect(record(evidence,second)).rejects.toThrow('invalid_ai_evidence')
  await expect(record({ ...evidence,sources:[{ kind:'case_answer',id:second }] })).rejects.toThrow('invalid_ai_evidence')
 })
 it('keeps private source RLS and denies client execution of model-context helpers',async() => {
  await save();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM case_gap_answers')).rows).toHaveLength(0);await db.exec('RESET ROLE')
  expect((await db.query("SELECT has_function_privilege('authenticated','load_case_gap_model_context(uuid,uuid,uuid)','execute') AS client_model_context,has_function_privilege('anon','case_gap_answer_snapshot_before()','execute') AS trigger_rpc")).rows).toEqual([{ client_model_context:false,trigger_rpc:false }])
 })
})
