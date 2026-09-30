import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333',member='44444444-4444-4444-8444-444444444444',rule='55555555-5555-4555-8555-555555555555',agent='66666666-6666-4666-8666-666666666666'
const snapshot={ titulo:'Delivery policy',cuando:'Delivery question',hacer:'Only confirm verified dates' }
beforeAll(async() => {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text);
 CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE);
 CREATE TABLE agent_guidance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,agent_id uuid REFERENCES ai_agents(id),titulo text NOT NULL,cuando text,hacer text NOT NULL,activa boolean NOT NULL DEFAULT true,orden integer DEFAULT 0,origen text DEFAULT 'comercio' CHECK(origen IN ('comercio','pliego')),clave text,updated_at timestamptz DEFAULT now());
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON agent_guidance TO authenticated;GRANT SELECT ON ai_agents,workspace_members,workspaces TO authenticated;`)
 const sql=readFileSync('supabase/migrations/313_guidance_versions.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users CASCADE;UPDATE billing SET allowed=true;SELECT set_config('request.jwt.claim.sub','',false),set_config('riverz.guidance_actor','',false);")
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,member]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent')",[ws,owner,member]);await db.query('INSERT INTO ai_agents VALUES($1,$2)',[agent,ws]);await db.query('INSERT INTO agent_guidance(id,workspace_id,titulo,hacer) VALUES($1,$2,$3,$4)',[rule,ws,'Original policy','Original response'])
})
const save=(live=1,draft=0,user=member,workspace=ws,body:unknown=snapshot) => db.query('SELECT save_guidance_draft($1,$2,$3,$4,$5,$6)',[workspace,rule,user,live,draft,JSON.stringify(body)])
const publish=(live=1,draft=1,user=owner) => db.query('SELECT publish_guidance_draft($1,$2,$3,$4,$5)',[ws,rule,user,live,draft])
const rollback=(live=2,target=1) => db.query('SELECT rollback_guidance_version($1,$2,$3,$4,$5)',[ws,rule,owner,live,target])
describe('published policy versions and isolated drafts',() => {
 it('allows workspace cleanup in read-only mode without resurrecting private audit',async() => {
  await save();await publish();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner])
  await db.exec('UPDATE billing SET allowed=false');await db.query('DELETE FROM workspaces WHERE id=$1',[ws])
  expect((await db.query('SELECT * FROM guidance_live_versions')).rows).toHaveLength(0)
  expect((await db.query('SELECT * FROM guidance_drafts')).rows).toHaveLength(0)
  expect((await db.query('SELECT * FROM agent_guidance')).rows).toHaveLength(0)
 })
 it('creates a member draft without enabling it and denies a live member publication',async() => {
  const id='77777777-7777-4777-8777-777777777777'
  await db.query('SELECT create_guidance_rule($1,$2,$3,NULL,$4,true)',[ws,member,id,JSON.stringify(snapshot)])
  expect((await db.query('SELECT activa,live_revision FROM agent_guidance WHERE id=$1',[id])).rows).toEqual([{ activa:false,live_revision:1 }])
  expect((await db.query('SELECT draft_revision FROM guidance_drafts WHERE rule_id=$1',[id])).rows).toEqual([{ draft_revision:1 }])
  await expect(db.query('SELECT create_guidance_rule($1,$2,gen_random_uuid(),NULL,$3,false)',[ws,member,JSON.stringify(snapshot)])).rejects.toThrow('invalid_guidance_context')
 })
 it('keeps every active rule within the actual prompt capacity',async() => {
  await db.query("INSERT INTO agent_guidance(workspace_id,titulo,hacer) SELECT $1,'Rule '||n,'Instruction' FROM generate_series(1,49) AS n",[ws])
  await expect(db.query("INSERT INTO agent_guidance(workspace_id,titulo,hacer) VALUES($1,'Invisible rule','Instruction')",[ws])).rejects.toThrow('guidance_capacity')
  expect((await db.query('SELECT count(*)::integer AS n FROM agent_guidance')).rows).toEqual([{ n:50 }])
 })
 it('keeps the live rule unchanged until explicit admin publication, recording exact versions',async() => {
  await save();expect((await db.query('SELECT titulo,hacer,live_revision FROM agent_guidance')).rows).toEqual([{ titulo:'Original policy',hacer:'Original response',live_revision:1 }])
  await expect(publish(1,1,member)).rejects.toThrow('guidance_admin_required');await publish()
  expect((await db.query('SELECT titulo,hacer,live_revision FROM agent_guidance')).rows).toEqual([{ titulo:snapshot.titulo,hacer:snapshot.hacer,live_revision:2 }])
  expect((await db.query('SELECT revision,actor_id FROM guidance_live_versions ORDER BY revision')).rows).toEqual([{ revision:1,actor_id:null },{ revision:2,actor_id:owner }]);expect((await db.query('SELECT * FROM guidance_drafts')).rows).toHaveLength(0)
 })
 it('rejects stale editors and publishes only the reviewed current draft',async() => {
  await save();await expect(save()).rejects.toThrow('guidance_changed');await save(1,1,member,ws,{ ...snapshot,hacer:'Edited response' })
  await expect(publish()).rejects.toThrow('guidance_changed');await publish(1,2);await expect(publish(1,2)).rejects.toThrow('guidance_changed')
 })
 it('creates a new immutable version on rollback and does not overwrite a newer policy',async() => {
  await save();await publish();await rollback();await expect(rollback(2)).rejects.toThrow('guidance_changed')
  expect((await db.query('SELECT titulo,live_revision FROM agent_guidance')).rows).toEqual([{ titulo:'Original policy',live_revision:3 }]);expect((await db.query('SELECT revision FROM guidance_live_versions ORDER BY revision')).rows).toEqual([{ revision:1 },{ revision:2 },{ revision:3 }])
 })
 it('detects a change from existing knowledge flows and lets an explicit fresh save rebase the draft',async() => {
  await save();await db.exec("UPDATE agent_guidance SET hacer='Updated by existing flow'");await expect(publish()).rejects.toThrow('guidance_changed')
  await save(2,1);await publish(2,2);expect((await db.query('SELECT live_revision FROM agent_guidance')).rows).toEqual([{ live_revision:3 }])
 })
 it('accepts existing default and Huecos sources, preserving their history',async() => {
  await db.query("INSERT INTO agent_guidance(workspace_id,titulo,hacer,origen) VALUES($1,'Default rule','Verify','base'),($1,'Known answer','Confirmed by owner','hueco')",[ws])
  expect((await db.query("SELECT source FROM guidance_live_versions WHERE source IN ('base','hueco') ORDER BY source")).rows).toEqual([{ source:'base' },{ source:'hueco' }])
 })
 it('rejects foreign workspaces, unsafe payloads, read-only edits and foreign assistants',async() => {
  await expect(save(1,0,member,other)).rejects.toThrow('invalid_guidance_context');await expect(save(1,0,member,ws,{ ...snapshot,workspace_id:other })).rejects.toThrow('invalid_guidance_draft')
  await db.query('UPDATE ai_agents SET workspace_id=$1 WHERE id=$2',[other,agent]);await expect(db.query('UPDATE agent_guidance SET agent_id=$1',[agent])).rejects.toThrow('invalid_guidance_agent')
  await db.exec('UPDATE billing SET allowed=false');await expect(save()).rejects.toThrow('subscription_read_only')
 })
 it('keeps audit after rule or author deletion and hides it after membership revocation',async() => {
  await save();await publish();await db.query('DELETE FROM auth.users WHERE id=$1',[owner]);await db.query('DELETE FROM agent_guidance WHERE id=$1',[rule])
  expect((await db.query('SELECT count(*)::integer AS n FROM guidance_live_versions')).rows).toEqual([{ n:3 }])
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM guidance_live_versions')).rows).toHaveLength(3)
  await db.exec('RESET ROLE');await db.query('DELETE FROM workspace_members WHERE user_id=$1',[member]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM guidance_live_versions')).rows).toHaveLength(0)
 })
 it('prevents direct member publication, version tampering and direct audit writes',async() => {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated');await expect(db.exec("UPDATE agent_guidance SET hacer='Bypass'")).rejects.toThrow('guidance_admin_required')
  expect((await db.query("SELECT has_table_privilege('authenticated','guidance_live_versions','insert') AS audit,has_function_privilege('authenticated','publish_guidance_draft(uuid,uuid,uuid,integer,integer)','execute') AS publish")).rows[0]).toEqual({ audit:false,publish:false })
  await db.exec('RESET ROLE');await db.exec('UPDATE agent_guidance SET live_revision=900');expect((await db.query('SELECT live_revision FROM agent_guidance')).rows).toEqual([{ live_revision:1 }])
 })
})
