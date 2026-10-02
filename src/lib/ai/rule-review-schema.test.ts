import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',contact='44444444-4444-4444-8444-444444444444';
const conv='55555555-5555-4555-8555-555555555555',turn='66666666-6666-4666-8666-666666666666',rule='77777777-7777-4777-8777-777777777777',msg='88888888-8888-4888-8888-888888888888';
const nonce='99999999-9999-4999-8999-999999999999',nonce2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const decision={application:'applied',transfer:'not_assessed',note:'',confirmed:true};
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const read=(who=actor,caseId=conv,turnId=turn,ruleId=rule)=>scalar('SELECT read_ai_rule_review($1,$2,$3,$4,$5)',[ws,who,caseId,turnId,ruleId]);
const save=(id=nonce,expected=0,body:unknown=decision,who=actor)=>scalar('SELECT write_ai_rule_review($1,$2,$3,$4,$5,$6,$7,$8)',[id,ws,who,conv,turn,rule,expected,body]);
const metrics=(who=actor)=>scalar('SELECT ai_rule_review_metrics($1,$2,$3)',[ws,rule,who]);
const exposure=(who=actor)=>scalar('SELECT ai_rule_context_metrics($1,$2,$3)',[ws,rule,who]);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE profiles(user_id uuid,full_name text);
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,connection_id uuid,channel text,deleted_at timestamptz);
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,deleted_at timestamptz);
 CREATE TABLE agent_guidance(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE guidance_live_versions(workspace_id uuid,rule_id uuid,revision integer,snapshot jsonb,PRIMARY KEY(rule_id,revision));
 CREATE TABLE ai_turn_evidence(id uuid PRIMARY KEY,workspace_id uuid,conversation_id uuid,inbound_message_id uuid,message_id uuid,message_ids uuid[],evidence jsonb,created_at timestamptz DEFAULT now(),status text DEFAULT 'sent',reason text);
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/356_ai_rule_reviews.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces,auth.users,workspace_members,profiles,contacts,channel_connections,conversations,messages,agent_guidance,guidance_live_versions,ai_turn_evidence CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,actor,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL),($1,$3,'agent',NULL)",[ws,actor,other]);await db.query("INSERT INTO profiles VALUES($1,'Synthetic reviewer')",[actor]);
 await db.query('INSERT INTO contacts VALUES($1,$2)',[contact,ws]);await db.query("INSERT INTO channel_connections VALUES($1,$2,'webchat',$3)",[nonce2,ws,actor]);
 await db.query("INSERT INTO conversations VALUES($1,$2,$3,$4,'webchat',NULL)",[conv,ws,contact,nonce2]);await db.query('INSERT INTO messages VALUES($1,$2,NULL)',[msg,conv]);
 await db.query('INSERT INTO agent_guidance VALUES($1,$2)',[rule,ws]);await db.query('INSERT INTO guidance_live_versions VALUES($1,$2,1,$3)',[ws,rule,{titulo:'Historical',cuando:'When needed',hacer:'Synthetic instruction',activa:true}]);
 await db.query('INSERT INTO ai_turn_evidence(id,workspace_id,conversation_id,inbound_message_id,message_ids,evidence) VALUES($1,$2,$3,$4,$5,$6)',[turn,ws,conv,msg,[],{version:1,rules:[{id:rule,revision:1,title:'Historical'}],tools:[]}]);
});
describe('Human rule assessments retain private evidence and honest denominators',()=>{
 it('keeps tables and execution private with fixed search paths',async()=>{expect(await scalar('SELECT ai_rule_review_ready()')).toBe(true);for(const role of ['anon','authenticated','service_role']){await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM ai_rule_review_events')).rejects.toThrow('permission denied');await expect(db.exec('SELECT * FROM ai_rule_reviews')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}});
 it('binds an assessment to the historical configuration rather than the current rule',async()=>{await db.query('INSERT INTO guidance_live_versions VALUES($1,$2,2,$3)',[ws,rule,{titulo:'NEW',hacer:'Changed',activa:true}]);expect(await read()).toMatchObject({rule_revision:1,rule:{titulo:'Historical'},review:null,history:[],can_edit:true,attribution:'team_assessment'});});
 it.each(['unknown_revision','duplicate','malformed','overflow','inactive','deleted_version','cross_workspace_version','missing_message'])('rejects unavailable historical context: %s',async kind=>{
  if(kind==='unknown_revision')await db.exec('DELETE FROM guidance_live_versions');if(kind==='duplicate')await db.query('UPDATE ai_turn_evidence SET evidence=$1',[{rules:[{id:rule,revision:1},{id:rule,revision:1}]}]);
  if(kind==='malformed'||kind==='overflow')await db.query('UPDATE ai_turn_evidence SET evidence=$1',[{rules:[{id:rule,revision:kind==='overflow'?2147483648:'fake'}]}]);
  if(kind==='inactive')await db.exec(`UPDATE guidance_live_versions SET snapshot=snapshot||'{"activa":false}'`);if(kind==='deleted_version')await db.exec(`UPDATE guidance_live_versions SET snapshot=snapshot||'{"deleted":true}'`);
  if(kind==='cross_workspace_version')await db.query('UPDATE guidance_live_versions SET workspace_id=$1',[other]);if(kind==='missing_message')await db.exec('UPDATE messages SET deleted_at=now()');
  await expect(read()).rejects.toThrow('rule_review_unavailable');await expect(save()).rejects.toThrow('rule_review_unavailable');expect(await scalar('SELECT count(*) FROM ai_rule_review_events')).toBe(0);
 });
 it('accepts the full supported integer range for a historical version',async()=>{await db.exec('UPDATE guidance_live_versions SET revision=2147483647');await db.query('UPDATE ai_turn_evidence SET evidence=$1',[{rules:[{id:rule,revision:2147483647}]}]);expect(await read()).toMatchObject({rule_revision:2147483647});});
 it('does not infer application from exposure or unreviewed turns',async()=>{expect(await exposure()).toMatchObject({recorded_turns:1,attribution:'context_only'});expect(await metrics()).toMatchObject({reviewed_turns:0,application_rate:null,attribution:'team_assessment'});});
 it('uses only the latest assessment per turn and retains correction history',async()=>{expect(await save()).toMatchObject({review:{revision:1,actor_id:actor,actor_name:'Synthetic reviewer'}});await save(nonce2,1,{application:'missed',transfer:'related',note:'Synthetic observation',confirmed:true});expect(await metrics()).toMatchObject({reviewed_turns:1,applied_turns:0,missed_turns:1,eligible_turns:1,application_rate:0,related_transfer_turns:1});const view=await read() as {history:{revision:number}[]};expect(view.history.map(item=>item.revision)).toEqual([2,1]);expect(await save()).toMatchObject({review:{revision:1,application:'applied'}});expect(await scalar('SELECT count(*) FROM ai_rule_review_events')).toBe(2);});
 it('recovers an identical receipt in read-only mode but rejects new writes',async()=>{await save();await db.exec('UPDATE workspaces SET writable=false');expect(await save()).toMatchObject({review:{revision:1}});expect(await read()).toMatchObject({can_edit:false});await expect(save(nonce2,1)).rejects.toThrow('subscription_read_only');});
 it('rejects stale revisions, reused nonces and actor changes without altering counters',async()=>{await save();await expect(save(nonce2,0)).rejects.toThrow('rule_review_changed');await expect(save(nonce,0,{...decision,note:'Changed'})).rejects.toThrow('rule_review_changed');await expect(save(nonce,0,decision,other)).rejects.toThrow('rule_review_changed');expect(await scalar('SELECT count(*) FROM ai_rule_review_events')).toBe(1);});
 it.each(['agent','section','revoked','contact','private_email','deleted_case'])('enforces current actor/source scope: %s',async kind=>{
  await db.query('UPDATE workspaces SET owner_id=$1 WHERE id=$2',[other,ws]);
  if(kind==='agent')await db.exec("UPDATE workspace_members SET role='agent'");if(kind==='section')await db.exec(`UPDATE workspace_members SET allowed_sections='["/bandeja"]'`);if(kind==='revoked')await db.exec('DELETE FROM workspace_members');
  if(kind==='contact')await db.query('UPDATE contacts SET workspace_id=$1',[other]);if(kind==='private_email'){await db.exec("UPDATE conversations SET channel='gmail'");await db.query("UPDATE channel_connections SET channel='gmail',created_by=$1",[other]);}if(kind==='deleted_case')await db.exec('UPDATE conversations SET deleted_at=now()');
  if(kind==='agent'){expect(await read()).toMatchObject({can_edit:false});await expect(save()).rejects.toThrow('rule_review_forbidden');}
  else {await expect(read()).rejects.toThrow('rule_review_not_found');await expect(save()).rejects.toThrow('rule_review_not_found');}
 });
 it('masks private cases in both context and assessment metrics',async()=>{await save();await db.exec("UPDATE conversations SET channel='gmail';UPDATE channel_connections SET channel='gmail'");expect(await metrics(other)).toMatchObject({reviewed_turns:0,application_rate:null});expect(await exposure(other)).toMatchObject({recorded_turns:0});expect(await metrics()).toMatchObject({reviewed_turns:1});});
 it('revokes counter access after section removal and source visibility after deletion',async()=>{await save();await db.exec(`UPDATE workspace_members SET allowed_sections='["/asistente"]'`);await expect(metrics(other)).rejects.toThrow('rule_review_not_found');await expect(exposure(other)).rejects.toThrow('invalid_ai_evidence');await db.exec('UPDATE messages SET deleted_at=now()');expect(await metrics()).toMatchObject({reviewed_turns:0});expect(await exposure()).toMatchObject({recorded_turns:0});});
 it.each([{...decision,confirmed:false},{...decision,actor_id:actor},{...decision,application:'missed'}, {...decision,application:'not_applicable',transfer:'related',note:'Synthetic detail'}])('rejects invalid or unconfirmed decisions',async body=>{await expect(save(nonce,0,body)).rejects.toThrow('invalid_rule_review');});
 it.each(['not_applicable','unverified'])('excludes %s from the application denominator',async application=>{await save(nonce,0,{...decision,application});expect(await metrics()).toMatchObject({reviewed_turns:1,eligible_turns:0,application_rate:null});});
 it('uses the turn date, not a late assessment date, for the 30-day cohort',async()=>{await db.exec("UPDATE ai_turn_evidence SET created_at=now()-interval '31 days'");await save();expect(await metrics()).toMatchObject({reviewed_turns:0});});
 it('reports the audited application and transfer samples separately',async()=>{
  await save();
  for(const [application,transfer,note] of [['missed','related','Synthetic observation'],['unverified','unrelated','']] as const){
   const id=await scalar('INSERT INTO ai_turn_evidence SELECT gen_random_uuid(),workspace_id,conversation_id,inbound_message_id,message_id,message_ids,evidence,created_at,status,reason FROM ai_turn_evidence WHERE id=$1 RETURNING id',[turn]);
   await scalar('SELECT write_ai_rule_review(gen_random_uuid(),$1,$2,$3,$4,$5,0,$6)',[ws,actor,conv,id,rule,{application,transfer,note,confirmed:true}]);
  }
  expect(await metrics()).toMatchObject({reviewed_turns:3,applied_turns:1,missed_turns:1,unverified_turns:1,eligible_turns:2,application_rate:50,related_transfer_turns:1,assessed_transfer_turns:2,distinct_reviewed_cases:1});
 });
 it('bounds visible correction history without deleting earlier events',async()=>{
  await save();await db.exec(`INSERT INTO ai_rule_review_events(id,workspace_id,conversation_id,turn_id,rule_id,rule_revision,revision,actor_id,actor_name,expected_revision,decision)
  SELECT gen_random_uuid(),workspace_id,conversation_id,turn_id,rule_id,rule_revision,n,actor_id,actor_name,n-1,decision FROM ai_rule_review_events CROSS JOIN generate_series(2,25) n WHERE revision=1;
  UPDATE ai_rule_reviews SET revision=25;`);
  const value=await read() as {history:{revision:number}[];history_truncated:boolean};expect(value.history).toHaveLength(20);expect(value.history[0].revision).toBe(25);expect(value.history_truncated).toBe(true);expect(await scalar('SELECT count(*) FROM ai_rule_review_events')).toBe(25);
 });
 it('enforces the per-turn correction limit while recovering the original receipt',async()=>{await save();await db.exec('UPDATE ai_rule_reviews SET revision=500');await expect(save(nonce2,500)).rejects.toThrow('rule_review_limit');expect(await save()).toMatchObject({review:{revision:1}});});
 it('does not open a rule review through a guessed case, turn or rule ID',async()=>{for(const target of [[other,turn,rule],[conv,other,rule],[conv,turn,other]])await expect(read(actor,...target as [string,string,string])).rejects.toThrow(/rule_review_not_found|rule_review_unavailable/);});
});
