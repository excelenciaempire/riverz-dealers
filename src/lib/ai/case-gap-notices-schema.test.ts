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
 const notices=readFileSync('supabase/migrations/319_case_gap_question_notices.sql','utf8');await db.exec(notices);await db.exec(notices)
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
const hash='a'.repeat(64),anotherHash='b'.repeat(64),claimId='99999999-9999-4999-8999-999999999999'
const reserve=(id=receipt,actor=owner,workspace=ws,caseId=conversation,source=gap,hashes=[hash]) => db.query<{ result:{ id:string;resumable:boolean } }>('SELECT reserve_case_gap_notice($1,$2,$3,$4,$5,$6) AS result',[id,workspace,actor,caseId,source,hashes])
const claim=(destinationCurrent=true,actor=owner,claim=claimId) => db.query<{ result:boolean }>('SELECT claim_case_gap_notice($1,$2,$3,$4,$5,$6) AS result',[receipt,ws,actor,hash,claim,destinationCurrent])
const finish=(state='accepted',messageId:string|null='wamid.actual',claim=claimId) => db.query<{ result:boolean }>('SELECT finish_case_gap_notice($1,$2,$3,$4,$5) AS result',[receipt,hash,claim,state,messageId])
const status=(actor=owner) => db.query<{ result:{ accepted:number;unconfirmed:number;pending:number;cancelled:number } }>('SELECT case_gap_notice_status($1,$2,$3) AS result',[ws,actor,gap])
describe('internal question notification receipts and no duplicate sends',() => {
 it('reserves one notice per source, deduplicates requests and permits only the original author and receipt to resume',async() => {
  expect((await reserve()).rows[0].result).toEqual({ id:receipt,resumable:true });expect((await reserve()).rows[0].result.resumable).toBe(true);expect((await reserve(second)).rows[0].result).toEqual({ id:receipt,resumable:false });expect((await status()).rows[0].result).toMatchObject({ pending:1,accepted:0 })
  expect((await db.query('SELECT * FROM case_gap_question_notices')).rows).toHaveLength(1)
 })
 it('claims exactly once and preserves uncertainty when no provider receipt was committed',async() => {
  await reserve();expect((await claim()).rows[0].result).toBe(true);expect((await claim(true,owner,second)).rows[0].result).toBe(false);expect((await status()).rows[0].result.unconfirmed).toBe(1)
  expect((await finish('uncertain',null)).rows[0].result).toBe(true);expect((await claim()).rows[0].result).toBe(false);expect((await finish()).rows[0].result).toBe(false)
 })
 it('requires a provider message id to call an attempt accepted, and an exact claim to finish it',async() => {
  await reserve();await claim();await expect(finish('accepted',null)).rejects.toThrow('invalid_gap_context');expect((await finish('accepted','wamid.actual',second)).rows[0].result).toBe(false);expect((await finish()).rows[0].result).toBe(true);expect((await status()).rows[0].result).toMatchObject({ accepted:1,unconfirmed:0 })
 })
 it('checks personal mailbox access and source/case/workspace binding before reserve, read or claim',async() => {
  await expect(reserve(receipt,member)).rejects.toThrow('invalid_gap_context');await expect(reserve(receipt,owner,other)).rejects.toThrow('invalid_gap_context');await expect(reserve(receipt,owner,ws,second)).rejects.toThrow('invalid_gap_context');await reserve();await expect(status(member)).rejects.toThrow('invalid_gap_context');await expect(claim(true,member)).rejects.toThrow('invalid_gap_context')
  await expect(db.query('SELECT list_case_gap_notices($1,$2,$3)',[ws,member,conversation])).rejects.toThrow('invalid_gap_context')
 })
 it('cancels removed recipients, read-only businesses and newly answered questions before any send claim',async() => {
  await reserve();expect((await claim(false)).rows[0].result).toBe(false);expect((await status()).rows[0].result.cancelled).toBe(1)
  await db.exec('TRUNCATE case_gap_question_notices CASCADE');await reserve();await db.exec('UPDATE billing SET allowed=false');expect((await claim()).rows[0].result).toBe(false)
  await db.exec('TRUNCATE case_gap_question_notices CASCADE;UPDATE billing SET allowed=true');await reserve();await db.query('SELECT save_case_gap_answer($1,$2,$3,$4,$5,0,$6)',[second,ws,owner,conversation,gap,'Only this case']);expect((await claim()).rows[0].result).toBe(false)
 })
 it('rejects new reservations for resolved questions, read-only businesses or invalid recipient arrays',async() => {
  await expect(reserve(receipt,owner,ws,conversation,gap,[])).rejects.toThrow('invalid_gap_context');await expect(reserve(receipt,owner,ws,conversation,gap,[hash,hash])).rejects.toThrow('invalid_gap_context');await expect(reserve(receipt,owner,ws,conversation,gap,['not a hash'])).rejects.toThrow('invalid_gap_context')
  await db.exec('UPDATE billing SET allowed=false');await expect(reserve()).rejects.toThrow('subscription_read_only');await db.exec('UPDATE billing SET allowed=true;UPDATE answer_gaps SET resolved_at=now()');await expect(reserve()).rejects.toThrow('gap_changed')
 })
 it('limits requests across the business under the workspace lock',async() => {
  for(let i=0;i<20;i++) {
   const source=`${String(i+20).padStart(8,'0')}-5555-4555-8555-555555555555`,request=`${String(i+20).padStart(8,'0')}-7777-4777-8777-777777777777`
   await db.query("INSERT INTO answer_gaps(id,workspace_id,conversation_id,channel,question,question_key) VALUES($1,$2,$3,'gmail','Question','question')",[source,ws,conversation]);await reserve(request,owner,ws,conversation,source,[anotherHash])
  }
  await expect(reserve()).rejects.toThrow('gap_notice_limit');expect((await db.query('SELECT count(*)::int AS n FROM case_gap_question_notices')).rows).toEqual([{ n:20 }])
 })
 it('never exposes recipient hashes or provider IDs through the readable status and denies all direct clients',async() => {
  await reserve();await claim();await finish();const result=(await db.query('SELECT list_case_gap_notices($1,$2,$3) AS result',[ws,owner,conversation])).rows[0];expect(JSON.stringify(result)).not.toContain(hash);expect(JSON.stringify(result)).not.toContain('wamid.actual')
  expect((await db.query("SELECT has_table_privilege('authenticated','case_gap_question_recipients','select') AS direct_read,has_table_privilege('authenticated','case_gap_question_notices','insert') AS direct_write,has_function_privilege('anon','reserve_case_gap_notice(uuid,uuid,uuid,uuid,uuid,text[])','execute') AS rpc")).rows).toEqual([{ direct_read:false,direct_write:false,rpc:false }])
 })
 it('revokes current access, retains the actual transport receipt after author deletion and cascades on case deletion',async() => {
  await reserve();await claim();await db.query('DELETE FROM auth.users WHERE id=$1',[owner]);await expect(status()).rejects.toThrow('invalid_gap_context');expect((await finish()).rows[0].result).toBe(true)
  await db.query('DELETE FROM conversations WHERE id=$1',[conversation]);expect((await db.query('SELECT * FROM case_gap_question_recipients')).rows).toHaveLength(0)
 })
})
