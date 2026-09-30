import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='22222222-2222-4222-8222-222222222222',member='33333333-3333-4333-8333-333333333333',agent='44444444-4444-4444-8444-444444444444',id='77777777-7777-4777-8777-777777777777',second='88888888-8888-4888-8888-888888888888'
const policy={ ig_comment:{ crear_pedido:'aprobacion',lookup_order:'off' } }
beforeAll(async() => {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text);CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,deleted_at timestamptz);CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;GRANT USAGE ON SCHEMA public,auth TO authenticated;`)
 const sql=readFileSync('supabase/migrations/321_ai_tool_context_policies.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
 await db.exec("RESET ROLE;TRUNCATE workspaces,auth.users CASCADE;UPDATE billing SET allowed=true;SELECT set_config('request.jwt.claim.sub','',false)")
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,member]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent')",[ws,owner,member]);await db.query('INSERT INTO ai_agents VALUES($1,$2,NULL)',[agent,ws])
})
const save=(receipt=id,revision=0,input:unknown=policy,actor=owner,workspace=ws) => db.query<{ result:{ revision:number;replayed:boolean } }>('SELECT save_ai_tool_context_policy($1,$2,$3,$4,$5,$6) AS result',[receipt,workspace,actor,agent,revision,JSON.stringify(input)])
describe('versioned context policies under admin-only atomic writes',() => {
 it('records the exact revision, author and policy with an idempotent receipt',async() => {
  expect((await save()).rows[0].result).toMatchObject({ revision:1,replayed:false });expect((await save()).rows[0].result).toMatchObject({ revision:1,replayed:true });expect((await db.query('SELECT revision,policy,actor_id FROM ai_tool_context_policy_versions')).rows).toEqual([{ revision:1,policy,actor_id:owner }])
 })
 it('rejects stale editors and changed or historical receipts without overwriting the latest configuration',async() => {
  await save();await expect(save(second)).rejects.toThrow('tool_context_changed');await expect(save(id,0,{})).rejects.toThrow('tool_context_changed');await save(second,1,{});await expect(save()).rejects.toThrow('tool_context_changed');expect((await db.query('SELECT revision,policy FROM ai_tool_context_policies')).rows).toEqual([{ revision:2,policy:{} }])
 })
 it('requires the current administrator, business and live assistant',async() => {
  await expect(save(id,0,policy,member)).rejects.toThrow('invalid_tool_context');await expect(save(id,0,policy,owner,other)).rejects.toThrow('invalid_tool_context');await db.exec('UPDATE ai_agents SET deleted_at=now()');await expect(save()).rejects.toThrow('invalid_tool_context')
 })
 it('disallows unsupported tools/channels, automatic overrides and approval for read-only tools',async() => {
  for (const input of [{ voice:{ lookup_order:'aprobacion' } },{ whatsapp:{ reembolsar:'auto' } },{ unknown:{ crear_pedido:'off' } },{ whatsapp:{ unknown:'off' } },[],null]) await expect(save(id,0,input)).rejects.toThrow('invalid_tool_context')
 })
 it('preserves an exact current receipt in read-only mode but rejects new changes',async() => {
  await save();await db.exec('UPDATE billing SET allowed=false');expect((await save()).rows[0].result.replayed).toBe(true);await expect(save(second,1,{})).rejects.toThrow('subscription_read_only')
 })
 it('denies direct client writes and cross-business reads',async() => {
  await save();expect((await db.query("SELECT has_table_privilege('authenticated','ai_tool_context_policies','update') AS direct_write,has_function_privilege('authenticated','save_ai_tool_context_policy(uuid,uuid,uuid,uuid,integer,jsonb)','execute') AS client_rpc")).rows).toEqual([{ direct_write:false,client_rpc:false }]);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT policy FROM ai_tool_context_policies')).rows).toHaveLength(1);await db.exec('RESET ROLE');await db.query('DELETE FROM workspace_members WHERE user_id=$1',[member]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT policy FROM ai_tool_context_policies')).rows).toHaveLength(0)
 })
 it('keeps history while removing a deleted author and removes configuration with its business',async() => {
  await save();await expect(db.exec("UPDATE ai_tool_context_policy_versions SET policy='{}'")).rejects.toThrow('invalid_tool_context');await db.query('DELETE FROM auth.users WHERE id=$1',[owner]);expect((await db.query('SELECT actor_id FROM ai_tool_context_policy_versions')).rows).toEqual([{ actor_id:null }]);await db.query('DELETE FROM workspaces WHERE id=$1',[ws]);expect((await db.query('SELECT * FROM ai_tool_context_policy_versions')).rows).toHaveLength(0)
 })
})
