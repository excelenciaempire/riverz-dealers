import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222',conversation='33333333-3333-4333-8333-333333333333';
const contact='44444444-4444-4444-8444-444444444444',message='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666';
const quote='Where is my order?';
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,deleted_at timestamptz);
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid,deleted_at timestamptz,is_active boolean,tools jsonb,scope text DEFAULT 'workspace',assigned_only boolean DEFAULT false);
 CREATE TABLE ai_agent_channels(agent_id uuid,channel text);
 CREATE TABLE ai_tool_context_policies(workspace_id uuid,agent_id uuid,policy jsonb);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,deleted_at timestamptz,is_spam boolean,case_reason text,channel text DEFAULT 'whatsapp',assigned_ai_agent_id uuid);
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,sender_type text,deleted_at timestamptz,created_at timestamptz,content_text text,media_transcription text);
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT allowed FROM public.billing$$;
 GRANT ALL ON conversations TO authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/347_assistant_case_reasons.sql','utf8'));
},30_000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces,ai_agents,ai_agent_channels,ai_tool_context_policies,conversations,messages CASCADE;UPDATE billing SET allowed=true');
 await db.query('INSERT INTO workspaces VALUES($1,NULL)',[ws]);
 await db.query('INSERT INTO ai_agents(id,workspace_id,deleted_at,is_active,tools) VALUES($1,$2,NULL,true,$3)',[agent,ws,{clasificar_motivo:'auto'}]);
 await db.query('INSERT INTO conversations(id,workspace_id,contact_id,is_spam) VALUES($1,$2,$3,false)',[conversation,ws,contact]);
 await db.query("INSERT INTO messages VALUES($1,$2,'customer',NULL,'2026-10-01T00:00:00Z',$3,NULL)",[message,conversation,quote]);
});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const classify=(overrides:Partial<{workspace:string;agent:string;conversation:string;contact:string;message:string;reason:string;quote:string}>={})=>scalar('SELECT classify_conversation_reason($1,$2,$3,$4,$5,$6,$7)',
 [overrides.workspace??ws,overrides.agent??agent,overrides.conversation??conversation,overrides.contact??contact,overrides.message??message,overrides.reason??'delivery',overrides.quote??quote]);
describe('Evidence-bound case reasons',()=>{
 it('keeps event data and classifier private while verifying the schema',async()=>{
  expect(await scalar('SELECT assistant_case_reasons_ready()')).toBe(true);
  await db.exec('SET ROLE authenticated');
  await expect(db.exec('SELECT * FROM assistant_case_reason_events')).rejects.toThrow('permission denied');
  await expect(classify()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('extends channel restrictions without permitting automatic overrides or weakening money controls',async()=>{
  expect(await scalar("SELECT ai_tool_context_policy_valid('{\"whatsapp\":{\"clasificar_motivo\":\"off\",\"reembolsar\":\"aprobacion\"}}')")).toBe(true);
  for(const mode of ['auto','aprobacion'])expect(await scalar('SELECT ai_tool_context_policy_valid($1)',[{whatsapp:{clasificar_motivo:mode}}])).toBe(false);
  expect(await scalar('SELECT ai_tool_context_policy_valid($1)',[{whatsapp:{reembolsar:'auto'}}])).toBe(false);
 });
 it('records one category and only a hash of the exact customer excerpt',async()=>{
  await db.exec('SET ROLE service_role');expect(await classify()).toEqual({status:'recorded',reason:'delivery'});await db.exec('RESET ROLE');
  expect((await db.query('SELECT case_reason,case_reason_source FROM conversations')).rows).toEqual([{case_reason:'delivery',case_reason_source:'assistant'}]);
  const event=(await db.query<{quote_hash:string}>('SELECT quote_hash FROM assistant_case_reason_events')).rows[0];
  expect(event.quote_hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(event)).not.toContain(quote);
  expect(await classify()).toEqual({status:'preserved',reason:'delivery'});expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(1);
 });
 it.each(['workspace','agent','conversation','contact','message'] as const)('rejects another %s binding',async key=>{
  await expect(classify({[key]:other})).rejects.toThrow();expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(0);
 });
 it.each(['disabled_tool','inactive_agent','deleted_agent','deleted_workspace','deleted_conversation','spam','billing'])('rejects %s without a write',async kind=>{
  const statement=kind==='disabled_tool'?"UPDATE ai_agents SET tools='{}'":kind==='inactive_agent'?'UPDATE ai_agents SET is_active=false':kind==='deleted_agent'?'UPDATE ai_agents SET deleted_at=now()':kind==='deleted_workspace'?'UPDATE workspaces SET deleted_at=now()':kind==='deleted_conversation'?'UPDATE conversations SET deleted_at=now()':kind==='spam'?'UPDATE conversations SET is_spam=true':'UPDATE billing SET allowed=false';
  await db.exec(statement);await expect(classify()).rejects.toThrow();expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(0);
 });
 it.each(['invented_quote','old_customer','staff','deleted_message','short_quote','invalid_reason'])('refuses %s evidence',async kind=>{
  if(kind==='old_customer')await db.query("INSERT INTO messages VALUES($1,$2,'customer',NULL,'2026-10-02T00:00:00Z',$3,NULL)",[other,conversation,'I need to return this item']);
  if(kind==='staff')await db.exec("UPDATE messages SET sender_type='agent'");
  if(kind==='deleted_message')await db.exec('UPDATE messages SET deleted_at=now()');
  await expect(classify(kind==='invented_quote'?{quote:'Please refund this purchase'}:kind==='short_quote'?{quote:'short'}:kind==='invalid_reason'?{reason:'invented'}:{})).rejects.toThrow();
  expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(0);
 });
 it('accepts an exact transcript excerpt without classifying unseen audio',async()=>{
  await db.exec('UPDATE messages SET media_transcription=content_text,content_text=NULL');expect(await classify()).toEqual({status:'recorded',reason:'delivery'});
 });
 it('fails closed when subscription authorization is unavailable',async()=>{
  await db.exec('UPDATE billing SET allowed=NULL');await expect(classify()).rejects.toThrow();
  expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(0);
 });
 it.each(['public_comment','voice','different_assistant','assigned_only','channel_scope','context_off','invalid_policy'])('respects current %s restrictions',async kind=>{
  if(kind==='public_comment')await db.exec("UPDATE conversations SET channel='ig_comment'");
  if(kind==='voice')await db.exec("UPDATE conversations SET channel='voice'");
  if(kind==='different_assistant')await db.query('UPDATE conversations SET assigned_ai_agent_id=$1',[other]);
  if(kind==='assigned_only')await db.exec('UPDATE ai_agents SET assigned_only=true');
  if(kind==='channel_scope')await db.exec("UPDATE ai_agents SET scope='channels'");
  if(kind==='context_off'||kind==='invalid_policy')await db.query('INSERT INTO ai_tool_context_policies VALUES($1,$2,$3)',[ws,agent,kind==='context_off'?{whatsapp:{clasificar_motivo:'off'}}:[]]);
  await expect(classify()).rejects.toThrow();expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(0);
 });
 it('permits current channel coverage and a different restriction that does not enable classification',async()=>{
  await db.exec("UPDATE ai_agents SET scope='channels'");await db.query("INSERT INTO ai_agent_channels VALUES($1,'whatsapp')",[agent]);
  await db.query('INSERT INTO ai_tool_context_policies VALUES($1,$2,$3)',[ws,agent,{whatsapp:{crear_pedido:'off'}}]);
  expect(await classify()).toEqual({status:'recorded',reason:'delivery'});
 });
 it('preserves historical categories without invented attribution',async()=>{
  await db.exec("UPDATE conversations SET case_reason='payment'");expect(await classify()).toEqual({status:'preserved',reason:'payment'});
  expect(await scalar('SELECT case_reason_source FROM conversations')).toBeNull();expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(0);
 });
 it.each(['authenticated','service_role'])('preserves %s manual clearing and refuses forged assistant provenance',async role=>{
  await db.exec(`SET ROLE ${role};UPDATE conversations SET case_reason=NULL,case_reason_source='assistant';RESET ROLE`);
  expect(await scalar('SELECT case_reason_source FROM conversations')).toBe('manual');expect(await classify()).toEqual({status:'preserved',reason:null});
 });
 it('keeps ordinary empty inserts eligible and stamps an explicitly chosen category as manual',async()=>{
  await db.exec('SET ROLE service_role');
  await db.query('INSERT INTO conversations(id,workspace_id,contact_id) VALUES($1,$2,$3)',[other,ws,contact]);
  expect(await scalar('SELECT case_reason_source FROM conversations WHERE id=$1',[other])).toBeNull();
  await db.query("UPDATE conversations SET case_reason='return' WHERE id=$1",[other]);
  expect(await scalar('SELECT case_reason_source FROM conversations WHERE id=$1',[other])).toBe('manual');await db.exec('RESET ROLE');
 });
 it('does not automatically reclassify after an explicit manual choice',async()=>{
  await classify();await db.exec("SET ROLE service_role;UPDATE conversations SET case_reason=NULL;RESET ROLE");
  expect(await classify()).toEqual({status:'preserved',reason:null});expect(await scalar('SELECT count(*) FROM assistant_case_reason_events')).toBe(1);
 });
 it('denies direct event writes and fails the guard if the provenance trigger is disabled',async()=>{
  await db.exec('SET ROLE service_role');await expect(db.exec('DELETE FROM assistant_case_reason_events')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  try{await db.exec('ALTER TABLE conversations DISABLE TRIGGER case_reason_manual_choice');expect(await scalar('SELECT assistant_case_reasons_ready()')).toBe(false);}
  finally{await db.exec('ALTER TABLE conversations ENABLE TRIGGER case_reason_manual_choice');}
 });
});
