import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',profile='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',call='55555555-5555-4555-8555-555555555555',contact='66666666-6666-4666-8666-666666666666',nonce='77777777-7777-4777-8777-777777777777',connection='88888888-8888-4888-8888-888888888888',peer='12025550100';
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const settings=(inbound=true,outbound=false,actor=owner)=>scalar('SELECT set_voice_whatsapp_settings($1,$2,$3,$4,$5)',[ws,actor,inbound,outbound,'26.0']);
const reserve=(values:Partial<{workspace:string;connection:string;call:string;agent:string;contact:string;nonce:string;direction:string;provider:string|null;peer:string;event:string|null;actor:string|null;global:number|null}>={})=>{
 const input={workspace:ws,connection,call,agent:profile,contact,nonce,direction:'inbound',provider:'wacid.fixture',peer,event:new Date().toISOString(),actor:null,global:10,...values};
 return scalar('SELECT reserve_voice_whatsapp_call($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',Object.values(input));
};
const finish=(result:string,provider:string|null=null)=>scalar('SELECT finish_voice_whatsapp_operation($1,$2,$3,$4)',[call,nonce,result,provider]);
const current=(operation='accept')=>scalar('SELECT voice_whatsapp_operation_current($1,$2,$3)',[call,nonce,operation]);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true,timezone text DEFAULT 'America/Bogota');
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE whatsapp_config(id uuid PRIMARY KEY,workspace_id uuid,phone_number_id text,waba_id text,status text);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,phone text,channel text,external_id text,voice_opt_out boolean);
 CREATE TABLE channel_connections(workspace_id uuid,channel text,config jsonb);
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid,is_active boolean,voice_enabled boolean,deleted_at timestamptz,scope text,voice_accepts_inbound boolean,voice_max_concurrent_calls integer,language text,voice_monthly_minutes_limit integer);
 CREATE TABLE ai_agent_channels(agent_id uuid,channel text);
 CREATE TABLE voice_calls(id uuid PRIMARY KEY,workspace_id uuid,agent_id uuid,contact_id uuid,direction text,call_type text,phone text,language text,status text,context jsonb,dispatch_priority integer,external_call_id text UNIQUE,attempt integer,max_attempts integer,started_at timestamptz,answered_at timestamptz,ended_at timestamptz,room_name text,duration_seconds integer,created_at timestamptz DEFAULT clock_timestamp());
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/370_whatsapp_calling_authority.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/371_whatsapp_calling_invoker_probe.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE voice_whatsapp_terminations,voice_whatsapp_sessions,voice_whatsapp_settings,voice_calls,ai_agent_channels,ai_agents,contacts,channel_connections,whatsapp_config,workspace_members,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);
 await db.query("INSERT INTO whatsapp_config VALUES($1,$2,'123456','456789','connected')",[connection,ws]);await db.query("INSERT INTO contacts VALUES($1,$2,$3,'whatsapp',$4,false)",[contact,ws,'+'+peer,peer]);
 await db.query("INSERT INTO ai_agents VALUES($1,$2,true,true,NULL,'workspace',true,3,'es',NULL)",[profile,ws]);
});
describe('Durable WhatsApp calling authority, local database only',()=>{
 it('runs the metadata probe as its caller with a fixed empty search path',async()=>{
  expect(await scalar("SELECT NOT prosecdef AND proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='whatsapp_calling_ready()'::regprocedure")).toBe(true);
  await db.exec('SET ROLE service_role');expect(await scalar('SELECT whatsapp_calling_ready()')).toBe(true);await db.exec('RESET ROLE');
 });
 it('preserves an opaque physical provider ID in reservation and termination',async()=>{
  await settings();const provider='wacid.fixture+/=';expect(await reserve({provider})).toMatchObject({claimed:true,binding:{providerCallId:provider}});
  expect(await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6)',['456789','123456',provider,peer,'inbound',other])).toMatchObject({claimed:true});
 });
 it.each(['has space','has\nline','has\u007fcontrol',''])('denies control/whitespace in an opaque provider ID %s',async provider=>{
  await settings();await expect(reserve({provider})).rejects.toThrow('invalid_whatsapp_voice');expect(await scalar('SELECT count(*) FROM voice_calls')).toBe(0);
 });
 it('starts opted out and denies an unauthorized settings reader',async()=>{expect(await scalar('SELECT voice_whatsapp_settings_read($1,$2)',[ws,owner])).toMatchObject({inbound_enabled:false,outbound_enabled:false});await expect(scalar('SELECT voice_whatsapp_settings_read($1,$2)',[ws,other])).rejects.toThrow('whatsapp_voice_not_found');});
 it('does not let a viewer/agent enable calling or bypass section access',async()=>{await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent','[\"/voz\"]')",[ws,other]);await expect(settings(true,false,other)).rejects.toThrow('whatsapp_voice_not_found');await db.exec("UPDATE workspace_members SET role='admin',allowed_sections='[\"/bandeja\"]'");await expect(settings(true,false,other)).rejects.toThrow('whatsapp_voice_not_found');});
 it('refuses ambiguous business-phone ownership across workspaces',async()=>{await db.query("INSERT INTO whatsapp_config VALUES($1,$2,'123456','456789','connected')",[other,other]);await expect(settings()).rejects.toThrow('whatsapp_voice_connection_unavailable');});
 it('requires an explicit policy before creating any call',async()=>{await expect(reserve()).rejects.toThrow('whatsapp_voice_not_allowed');expect(await scalar('SELECT count(*) FROM voice_calls')).toBe(0);});
 it('claims one inbound physical call and never marks it answered at acceptance',async()=>{await settings();expect(await reserve()).toMatchObject({claimed:true,call:{id:call,status:'dialing',answered_at:null,room_name:'voice_'+call,max_attempts:1},binding:{phoneNumberId:'123456',peer,direction:'inbound'}});expect(await current()).toBe(true);expect(await finish('accepted')).toBe(true);expect(await current()).toBe(false);expect(await reserve({call:other,nonce:other})).toMatchObject({claimed:false,call_id:call,state:'accepted'});expect(await scalar('SELECT count(*) FROM voice_calls')).toBe(1);});
 it('does not reuse a physical leg for another peer or tenant',async()=>{await settings();await reserve();await expect(reserve({peer:'573001234567'})).rejects.toThrow('whatsapp_voice_changed');await expect(reserve({workspace:other})).rejects.toThrow('whatsapp_voice_connection_unavailable');});
 it('requires the exact contact and rejects another workspace contact',async()=>{await settings();await db.query('UPDATE contacts SET workspace_id=$1',[other]);await expect(reserve()).rejects.toThrow('whatsapp_voice_not_found');expect(await scalar('SELECT count(*) FROM voice_calls')).toBe(0);});
 it.each(['2000-01-01T00:00:00Z','2099-01-01T00:00:00Z'])('refuses a new replayed/future offer %s',async event=>{await settings();await expect(reserve({event})).rejects.toThrow('whatsapp_voice_changed');});
 it('keeps a terminate-before-connect tombstone from starting a call',async()=>{await settings();await db.query("INSERT INTO voice_whatsapp_terminations(connection_id,provider_call_id) VALUES($1,'wacid.fixture')",[connection]);await expect(reserve()).rejects.toThrow('whatsapp_voice_changed');});
 it('checks current billing, agent eligibility and concurrency at reservation',async()=>{await settings();await db.exec('UPDATE workspaces SET writable=false');await expect(reserve()).rejects.toThrow('whatsapp_voice_read_only');await db.exec('UPDATE workspaces SET writable=true;UPDATE ai_agents SET voice_accepts_inbound=false');await expect(reserve()).rejects.toThrow('whatsapp_voice_not_allowed');await db.exec('UPDATE ai_agents SET voice_accepts_inbound=true,voice_max_concurrent_calls=1');await reserve();await expect(reserve({call:other,provider:'wacid.second'})).rejects.toThrow('whatsapp_voice_capacity_unavailable');});
 it('does not redial an uncertain outbound attempt or bypass opt-out',async()=>{await settings(false,true);await db.exec('UPDATE contacts SET voice_opt_out=true');await expect(reserve({direction:'outbound',provider:null,event:null,actor:owner})).rejects.toThrow('whatsapp_voice_not_found');await db.exec('UPDATE contacts SET voice_opt_out=false');await reserve({direction:'outbound',provider:null,event:null,actor:owner});expect(await current('dial')).toBe(true);await finish('uncertain');expect(await current('dial')).toBe(false);expect(await reserve({direction:'outbound',provider:null,event:null,actor:owner})).toMatchObject({claimed:false,state:'uncertain'});});
 it('revokes new connector operations when the account/config or policy changes',async()=>{await settings();await reserve();await db.exec("UPDATE whatsapp_config SET phone_number_id='999'");expect(await current()).toBe(false);expect(await scalar('SELECT voice_whatsapp_call_context($1)',[call])).toBeNull();await db.exec("UPDATE whatsapp_config SET phone_number_id='123456'");await settings(false,false);expect(await current()).toBe(false);});
 it('binds the outbound provider ID once, without accepting another returned leg',async()=>{await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});expect(await finish('initiated','wacid.outbound')).toBe(true);expect(await scalar("SELECT context->'__whatsapp_call'->>'providerCallId' FROM voice_calls WHERE id=$1",[call])).toBe('wacid.outbound');await expect(finish('initiated','wacid.other')).rejects.toThrow('whatsapp_voice_changed');});
 it('does not let an old worker acknowledgement revive a terminated session',async()=>{await settings();await reserve();await db.exec("UPDATE voice_whatsapp_sessions SET state='terminated'");expect(await finish('accepted')).toBe(false);expect(await scalar('SELECT voice_whatsapp_call_context($1)',[call])).toBeNull();});
 it('claims an answer that races the dial response once through the signed callback reference',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});
  const answer=await scalar('SELECT claim_voice_whatsapp_answer($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.outbound',peer,call,nonce]);
  expect(answer).toMatchObject({claimed:true,binding:{providerCallId:'wacid.outbound'},nonce});expect(await current('connect')).toBe(true);
  expect(await scalar('SELECT claim_voice_whatsapp_answer($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.outbound',peer,call,other])).toMatchObject({claimed:false,state:'connecting'});
  await finish('answer_accepted');expect(await scalar('SELECT answered_at FROM voice_calls WHERE id=$1',[call])).toBeNull();
 });
 it('prevents a forged outbound answer from replacing account, peer or physical ID',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});
  await expect(scalar('SELECT claim_voice_whatsapp_answer($1,$2,$3,$4,$5,$6)',['999','123456','wacid.outbound',peer,call,nonce])).rejects.toThrow('whatsapp_voice_not_found');
  await expect(scalar('SELECT claim_voice_whatsapp_answer($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.outbound','573001234567',call,nonce])).rejects.toThrow('whatsapp_voice_not_found');
 });
 it('preserves prompt/config billing context and only marks answered after the exact participant observation',async()=>{
  await settings();await reserve();await finish('accepted');
  await db.query("UPDATE voice_calls SET context=context||'{\"wallet_media_operation\":\"fixture-reservation\"}'::jsonb WHERE id=$1",[call]);
  await expect(scalar('SELECT mark_voice_whatsapp_connected($1,$2,$3)',[call,'another-room','whatsapp-'+call])).rejects.toThrow('invalid_whatsapp_voice');
  expect(await scalar('SELECT mark_voice_whatsapp_connected($1,$2,$3)',[call,'voice_'+call,'whatsapp-'+call])).toBe(true);
  expect(await scalar('SELECT status FROM voice_calls WHERE id=$1',[call])).toBe('in_progress');expect(await scalar("SELECT context->>'wallet_media_operation' FROM voice_calls WHERE id=$1",[call])).toBe('fixture-reservation');
 });
 it('deduplicates signed termination cleanup even after opting out of future calls',async()=>{
  await settings();await reserve();await finish('accepted');await settings(false,false);
  const args=['456789','123456','wacid.fixture',peer,'inbound',nonce];
  expect(await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6)',args)).toMatchObject({claimed:true,call_id:call});
  expect(await current('disconnect')).toBe(true);expect(await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6)',args)).toEqual({claimed:false});
  expect(await finish('accepted')).toBe(false);expect(await current('accept')).toBe(false);
 });
 it('records an unknown termination before a late offer without creating a customer call',async()=>{
  await settings();expect(await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.fixture',peer,'inbound',nonce])).toEqual({claimed:false});
  expect(await scalar('SELECT count(*) FROM voice_calls')).toBe(0);await expect(reserve()).rejects.toThrow('whatsapp_voice_changed');
 });
 it('makes tables/helpers private and rejects null operation identities',async()=>{expect(await scalar('SELECT whatsapp_calling_ready()')).toBe(true);expect(await current()).toBe(false);expect(await scalar("SELECT voice_whatsapp_operation_current(NULL,NULL,'accept')")).toBe(false);await db.exec('SET ROLE service_role');await expect(db.query('SELECT * FROM voice_whatsapp_sessions')).rejects.toThrow('permission denied');await db.exec('RESET ROLE;SET ROLE authenticated');await expect(scalar('SELECT whatsapp_calling_ready()')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');});
 it('recovers an initiated outbound call after the provider ID has been bound without another reservation',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});await finish('initiated','wacid.outbound');
  await settings(false,false);expect(await reserve({direction:'outbound',provider:null,event:null,actor:owner})).toMatchObject({claimed:false,state:'initiated'});
  expect(await scalar('SELECT voice_whatsapp_outbound_receipt($1,$2,$3)',[ws,owner,call])).toMatchObject({callId:call,contactId:contact,state:'initiated'});
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)",[ws,other]);
  expect(await scalar('SELECT voice_whatsapp_outbound_receipt($1,$2,$3)',[ws,other,call])).toBeNull();
  await expect(reserve({direction:'outbound',provider:null,event:null,actor:other})).rejects.toThrow('whatsapp_voice_changed');
 });
 it('binds a signed outbound termination that arrives before the dial acknowledgement',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});
  expect(await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6,$7)',['456789','123456','wacid.outbound',peer,'outbound',other,call])).toMatchObject({claimed:true,binding:{providerCallId:'wacid.outbound'},nonce:other});
  await expect(finish('initiated','wacid.outbound')).rejects.toThrow('whatsapp_voice_not_found');
  expect(await scalar('SELECT state FROM voice_whatsapp_sessions WHERE call_id=$1',[call])).toBe('terminated');
  expect(await scalar('SELECT answered_at FROM voice_calls WHERE id=$1',[call])).toBeNull();
 });
 it('blocks an answer when an unknown termination lacked the callback reference',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});
  await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.outbound',peer,'outbound',other]);
  await finish('initiated','wacid.outbound');expect(await scalar('SELECT voice_whatsapp_call_context($1)',[call])).toBeNull();
  await expect(scalar('SELECT claim_voice_whatsapp_answer($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.outbound',peer,call,other])).rejects.toThrow('whatsapp_voice_changed');
 });
 it('keeps cleanup acknowledgement separate from termination and disallows duplicate disconnect attempts',async()=>{
  await settings();await reserve();await finish('accepted');await settings(false,false);
  expect(await scalar('SELECT claim_voice_whatsapp_business_end($1,$2,$3,$4)',[call,'voice_'+call,'whatsapp-'+call,nonce])).toMatchObject({claimed:true});
  expect(await scalar('SELECT cleanup_state FROM voice_whatsapp_sessions WHERE call_id=$1',[call])).toBe('pending');
  expect(await scalar('SELECT finish_voice_whatsapp_cleanup($1,$2,$3)',[call,other,true])).toBe(false);
  expect(await scalar('SELECT finish_voice_whatsapp_cleanup($1,$2,$3)',[call,nonce,false])).toBe(true);
  expect(await scalar('SELECT finish_voice_whatsapp_cleanup($1,$2,$3)',[call,nonce,true])).toBe(false);
  expect(await scalar('SELECT claim_voice_whatsapp_business_end($1,$2,$3,$4)',[call,'voice_'+call,'whatsapp-'+call,other])).toEqual({claimed:false});
  expect(await scalar('SELECT cleanup_state FROM voice_whatsapp_sessions WHERE call_id=$1',[call])).toBe('uncertain');
 });
 it('purges minimal old tombstones and terminal controls without deleting active calls',async()=>{
  await settings();await reserve();await db.query("INSERT INTO voice_whatsapp_terminations(connection_id,provider_call_id,received_at) VALUES($1,'old',clock_timestamp()-interval '2 days'),($1,'recent',clock_timestamp())",[connection]);
  await db.exec("UPDATE voice_whatsapp_sessions SET updated_at=clock_timestamp()-interval '31 days'");
  expect(await scalar('SELECT purge_voice_whatsapp_control()')).toEqual({tombstones:1,sessions:0});
  await db.exec("UPDATE voice_calls SET ended_at=clock_timestamp()-interval '31 days',status='failed'");
  expect(await scalar('SELECT purge_voice_whatsapp_control()')).toEqual({tombstones:0,sessions:1});
  expect(await scalar('SELECT count(*) FROM voice_calls')).toBe(1);
  await expect(scalar('SELECT purge_voice_whatsapp_control(501)')).rejects.toThrow('invalid_whatsapp_voice');
 });
 it('does not advertise readiness with a leaked helper permission',async()=>{
  await db.exec('GRANT EXECUTE ON FUNCTION finish_voice_whatsapp_cleanup(uuid,uuid,boolean) TO authenticated');expect(await scalar('SELECT whatsapp_calling_ready()')).toBe(false);
  await db.exec('REVOKE ALL ON FUNCTION finish_voice_whatsapp_cleanup(uuid,uuid,boolean) FROM authenticated');expect(await scalar('SELECT whatsapp_calling_ready()')).toBe(true);
 });
 it('respects shared workspace and global capacity and reserved inbound slots',async()=>{
  await settings(true,true);await db.query("INSERT INTO channel_connections VALUES($1,'voice','{\"max_concurrent_calls\":2,\"reserved_inbound_slots\":1}')",[ws]);
  await db.query("INSERT INTO contacts VALUES($1,$2,'+12025550101','whatsapp','12025550101',false)",[profile,ws]);
  await reserve({direction:'outbound',provider:null,event:null,actor:owner});
  await expect(reserve({call:other,contact:profile,peer:'12025550101',direction:'outbound',provider:null,event:null,actor:owner})).rejects.toThrow('whatsapp_voice_capacity_unavailable');
  expect(await reserve({call:other,provider:'wacid.second'})).toMatchObject({claimed:true});
  await expect(reserve({call:contact,provider:'wacid.third'})).rejects.toThrow('whatsapp_voice_capacity_unavailable');
 });
 it('checks the monthly agent limit without treating null as a cap',async()=>{
  await settings();await reserve();await db.exec("UPDATE voice_calls SET status='completed',ended_at=clock_timestamp(),duration_seconds=60;UPDATE ai_agents SET voice_monthly_minutes_limit=1");
  await expect(reserve({call:other,provider:'wacid.second'})).rejects.toThrow('whatsapp_voice_not_allowed');
  await db.exec('UPDATE ai_agents SET voice_monthly_minutes_limit=NULL');expect(await reserve({call:other,provider:'wacid.second'})).toMatchObject({claimed:true});
 });
 it('rechecks contact opt-out and actor authority immediately before the SDK operation',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});expect(await current('dial')).toBe(true);
  await db.exec('UPDATE contacts SET voice_opt_out=true');expect(await current('dial')).toBe(false);
  await db.exec('UPDATE contacts SET voice_opt_out=false');await db.query('UPDATE workspaces SET owner_id=$1 WHERE id=$2',[other,ws]);expect(await current('dial')).toBe(false);
 });
 it('cancels a failed preflight before connector dispatch without marking media observed',async()=>{
  await settings();await reserve();expect(await scalar('SELECT cancel_voice_whatsapp_preflight($1,$2)',[call,nonce])).toBe(true);
  expect(await current()).toBe(false);expect(await scalar('SELECT status FROM voice_calls WHERE id=$1',[call])).toBe('canceled');
  expect(await scalar('SELECT answered_at FROM voice_calls WHERE id=$1',[call])).toBeNull();expect(await scalar('SELECT cancel_voice_whatsapp_preflight($1,$2)',[call,nonce])).toBe(false);
 });
 it('uses the same global ceiling as the PSTN dispatcher',async()=>{
  await settings();await reserve();await expect(reserve({call:other,provider:'wacid.second',global:1})).rejects.toThrow('whatsapp_voice_capacity_unavailable');
  await expect(reserve({call:other,provider:'wacid.second',global:null})).rejects.toThrow('invalid_whatsapp_voice');
 });
 it('does not redial an uncertain ended leg until Meta confirms termination',async()=>{
  await settings(false,true);await reserve({direction:'outbound',provider:null,event:null,actor:owner});await finish('initiated','wacid.outbound');
  await db.exec("UPDATE voice_calls SET status='failed',ended_at=clock_timestamp()");
  await scalar('SELECT claim_voice_whatsapp_business_end($1,$2,$3,$4)',[call,'voice_'+call,'whatsapp-'+call,nonce]);await scalar('SELECT finish_voice_whatsapp_cleanup($1,$2,$3)',[call,nonce,false]);
  await expect(reserve({call:other,direction:'outbound',provider:null,event:null,actor:owner})).rejects.toThrow('whatsapp_voice_changed');
  await scalar('SELECT claim_voice_whatsapp_termination($1,$2,$3,$4,$5,$6)',['456789','123456','wacid.outbound',peer,'outbound',nonce]);
  expect(await scalar('SELECT voice_whatsapp_outbound_receipt($1,$2,$3)',[ws,owner,call])).toMatchObject({providerEnded:true,cleanupState:'uncertain'});
  expect(await reserve({call:other,direction:'outbound',provider:null,event:null,actor:owner})).toMatchObject({claimed:true});
 });
});
