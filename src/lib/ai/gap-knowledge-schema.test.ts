import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='22222222-2222-4222-8222-222222222222',member='33333333-3333-4333-8333-333333333333',conversation='44444444-4444-4444-8444-444444444444',gap='55555555-5555-4555-8555-555555555555',product='66666666-6666-4666-8666-666666666666',review='77777777-7777-4777-8777-777777777777',later='88888888-8888-4888-8888-888888888888'
const question='Delivery time?',key='delivery time',answer='Only confirmed dates',prepared={ custom_faqs:[{ q:question,a:answer }],training_material:'Reviewed FAQ' }
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
 const sql=readFileSync('supabase/migrations/317_gap_knowledge_reviews.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users,channel_connections CASCADE;UPDATE billing SET allowed=true;SELECT set_config('request.jwt.claim.sub','',false),set_config('riverz.guidance_actor','',false)")
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,member]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent')",[ws,owner,member]);await db.query('INSERT INTO channel_connections VALUES($1,$2,$3)',[product,ws,owner]);await db.query("INSERT INTO conversations VALUES($1,$2,'gmail',$3,NULL)",[conversation,ws,product]);await db.query("INSERT INTO answer_gaps(id,workspace_id,conversation_id,channel,question,question_key) VALUES($1,$2,$3,'gmail',$4,$5)",[gap,ws,conversation,question,key]);await db.query("INSERT INTO shopify_products VALUES($1,$2,'Existing product','[]','Old material','Original')",[product,ws])
})
const snapshot=async() => (await db.query<{ value:unknown }>('SELECT to_jsonb(p) AS value FROM shopify_products p WHERE id=$1',[product])).rows[0].value
const prepare=async(destination='producto',actor=owner,ids=[gap],expected?:unknown,newQuestion=question) => db.query('SELECT prepare_gap_knowledge_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[review,ws,actor,key,newQuestion,answer,destination,destination==='producto' ? product : null,'Existing product',ids,JSON.stringify(expected===undefined ? destination==='producto' ? await snapshot() : null : expected),JSON.stringify(destination==='producto' ? prepared : {}),'[]'])
const confirm=(actor=owner,workspace=ws) => db.query('SELECT confirm_gap_knowledge_review($1,$2,$3)',[workspace,actor,review])
const visible=(actor=owner) => db.query('SELECT * FROM list_visible_answer_gaps($1,$2,false)',[ws,actor])
describe('reviewed supervised knowledge on existing destinations',() => {
 it('keeps previews inactive, atomically compiles the FAQ and closes only reviewed sources',async() => {
  await prepare();expect((await db.query('SELECT custom_faqs FROM shopify_products')).rows).toEqual([{ custom_faqs:[] }]);expect((await visible()).rows).toHaveLength(1)
  await db.query("INSERT INTO answer_gaps(id,workspace_id,conversation_id,channel,question,question_key) VALUES($1,$2,$3,'gmail',$4,$5)",[later,ws,conversation,question,key]);await confirm()
  expect((await db.query('SELECT custom_faqs,training_material FROM shopify_products')).rows).toEqual([{ custom_faqs:prepared.custom_faqs,training_material:'Reviewed FAQ' }]);expect(((await visible()).rows as Array<{id:string}>).map(g => g.id)).toEqual([later])
  expect((await db.query('SELECT actor_id,state,expected_snapshot,prepared FROM gap_knowledge_reviews')).rows).toEqual([{ actor_id:owner,state:'published',expected_snapshot:null,prepared:{} }])
 })
 it('returns the same receipt on confirmation retry without writing twice',async() => {
  await prepare();await confirm();await db.exec('UPDATE billing SET allowed=false');const result=await confirm()
  expect(result.rows[0]).toMatchObject({ confirm_gap_knowledge_review:{ ok:true,replayed:true } });expect((await db.query('SELECT count(*)::int AS n FROM gap_knowledge_reviews')).rows[0]).toEqual({ n:1 })
 })
 it('rejects stale product reviews without overwriting another editor or closing sources',async() => {
  await prepare();await db.exec("UPDATE shopify_products SET description='Changed by another editor'");await expect(confirm()).rejects.toThrow('gap_changed');expect((await visible()).rows).toHaveLength(1)
 })
 it('rejects expired reviews and already resolved sources',async() => {
  await prepare();await db.exec("UPDATE gap_knowledge_reviews SET expires_at=now()-interval '1 second'");await expect(confirm()).rejects.toThrow('gap_changed')
  await db.exec("UPDATE gap_knowledge_reviews SET expires_at=now()+interval '10 minutes';UPDATE answer_gaps SET resolved_at=now()");await expect(confirm()).rejects.toThrow('gap_changed')
 })
 it('rechecks membership, private mailbox ownership and current billing before publishing',async() => {
  await prepare();await expect(confirm(member)).rejects.toThrow('invalid_gap_context');await expect(confirm(owner,other)).rejects.toThrow('invalid_gap_context')
  await db.query('UPDATE channel_connections SET created_by=$1',[member]);await expect(confirm()).rejects.toThrow('invalid_gap_context');await db.query('UPDATE channel_connections SET created_by=$1',[owner]);await db.exec('UPDATE billing SET allowed=false');await expect(confirm()).rejects.toThrow('subscription_read_only')
  await db.exec('UPDATE billing SET allowed=true');await db.query('DELETE FROM workspace_members WHERE user_id=$1',[owner]);await expect(confirm()).rejects.toThrow('invalid_gap_context')
 })
 it('publishes business policy only for administrators and records its real version and author',async() => {
  await db.exec("UPDATE conversations SET channel='whatsapp';UPDATE answer_gaps SET channel='whatsapp'");await expect(prepare('regla',member)).rejects.toThrow('gap_admin_required');await prepare('regla');await confirm()
  expect((await db.query('SELECT agent_id,hacer,origen,clave,live_revision FROM agent_guidance')).rows).toEqual([{ agent_id:null,hacer:answer,origen:'hueco',clave:'hueco_delivery time',live_revision:1 }]);expect((await db.query('SELECT actor_id FROM guidance_live_versions')).rows).toEqual([{ actor_id:owner }])
 })
 it('does not silently replace a business policy edited after review',async() => {
  await prepare('regla');await db.query("INSERT INTO agent_guidance(workspace_id,titulo,hacer,clave) VALUES($1,'New policy','New answer','hueco_delivery time')",[ws]);await expect(confirm()).rejects.toThrow('gap_changed')
 })
 it('rejects forged or duplicate source references and questions unrelated to the actual gap',async() => {
  await expect(prepare('producto',owner,[gap,gap])).rejects.toThrow('invalid_gap_context');await expect(prepare('producto',owner,[later])).rejects.toThrow('invalid_gap_context');await expect(prepare('producto',owner,[gap],undefined,'Different question')).rejects.toThrow('invalid_gap_context')
  const foreign={ ...(await snapshot() as object),workspace_id:other };await expect(prepare('producto',owner,[gap],foreign)).rejects.toThrow('gap_changed')
 })
 it('hides private and deleted-case gaps through both service reads and RLS, including after deletion',async() => {
  expect((await visible(member)).rows).toHaveLength(0);await prepare();await confirm();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated')
  expect((await db.query('SELECT * FROM answer_gaps')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM gap_knowledge_reviews')).rows).toHaveLength(0)
  await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.query('DELETE FROM conversations WHERE id=$1',[conversation]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM answer_gaps')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM gap_knowledge_reviews')).rows).toHaveLength(0)
 })
 it('manual resolution affects only accessible occurrences, and never reports a nonexistent group as resolved',async() => {
  await expect(db.query('SELECT resolve_visible_answer_gaps($1,$2,$3)',[ws,member,key])).rejects.toThrow('invalid_gap_context');expect((await db.query('SELECT resolve_visible_answer_gaps($1,$2,$3) AS n',[ws,owner,key])).rows[0]).toEqual({ n:1 })
  await expect(db.query('SELECT resolve_visible_answer_gaps($1,$2,$3)',[ws,owner,key])).rejects.toThrow('invalid_gap_context')
 })
 it('never resurrects gaps after a public case is erased, but permits genuinely unbound public questions',async() => {
  await db.exec("UPDATE conversations SET channel='whatsapp';UPDATE answer_gaps SET channel='whatsapp'");await db.query('DELETE FROM conversations WHERE id=$1',[conversation]);expect((await visible()).rows).toHaveLength(0)
  await db.query("INSERT INTO answer_gaps(id,workspace_id,channel,question,question_key) VALUES($1,$2,'whatsapp',$3,$4)",[later,ws,question,key]);expect((await visible()).rows.map(g => (g as {id:string}).id)).toEqual([later])
  await db.exec('UPDATE answer_gaps SET source_conversation_required=false');expect((await visible()).rows.map(g => (g as {id:string}).id)).toEqual([later])
 })
 it('prevents truncated rule keys from merging unrelated long questions',async() => {
  const prefix='a'.repeat(195);const result=await db.query<{ one:string;two:string }>('SELECT gap_guidance_key($1) AS one,gap_guidance_key($2) AS two',[prefix+'one',prefix+'two']);expect(result.rows[0].one).not.toBe(result.rows[0].two);expect(result.rows[0].one.length).toBeLessThanOrEqual(200)
 })
 it('denies direct client writes and publication RPCs while retaining readable provenance until workspace removal',async() => {
  expect((await db.query("SELECT has_table_privilege('authenticated','answer_gaps','update') AS gap_write,has_table_privilege('authenticated','gap_knowledge_reviews','insert') AS audit_write,has_function_privilege('authenticated','confirm_gap_knowledge_review(uuid,uuid,uuid)','execute') AS rpc")).rows).toEqual([{ gap_write:false,audit_write:false,rpc:false }])
  await prepare();await confirm();await db.query('DELETE FROM auth.users WHERE id=$1',[owner]);expect((await db.query('SELECT actor_id FROM gap_knowledge_reviews')).rows).toEqual([{ actor_id:null }]);await db.query('DELETE FROM workspaces WHERE id=$1',[ws]);expect((await db.query('SELECT * FROM gap_knowledge_reviews')).rows).toHaveLength(0)
 })
})
