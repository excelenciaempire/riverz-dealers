import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {humanHandoffSnapshot} from './human-handoff-contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',call='55555555-5555-4555-8555-555555555555',contact='66666666-6666-4666-8666-666666666666',worker='77777777-7777-4777-8777-777777777777',id='88888888-8888-4888-8888-888888888888';
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const register=(room='voice_'+call,identity='caller-'+call,nonce=worker)=>scalar('SELECT register_voice_human_runtime($1,$2,$3,$4)',[call,nonce,room,identity]);
const request=(actor=owner,job=id,tenant=ws)=>scalar('SELECT request_voice_human_handoff($1,$2,$3,$4)',[tenant,actor,call,job]);
const snapshot=(actor=owner)=>scalar('SELECT voice_human_snapshot($1,$2,$3)',[ws,actor,call]);
const ack=(phase='ready',nonce=worker)=>scalar('SELECT ack_voice_human_handoff($1,$2,$3,$4)',[call,nonce,id,phase]);
const poll=()=>scalar('SELECT poll_voice_human_runtime($1,$2)',[call,worker]);
const grant=(actor=owner)=>scalar('SELECT voice_human_grant_context($1,$2,$3,$4)',[ws,actor,call,id]);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid);CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,deleted_at timestamptz,channel text,connection_id uuid);
 CREATE TABLE voice_calls(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,conversation_id uuid,status text,direction text,external_call_id text,room_name text,answered_at timestamptz);
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/369_voice_human_handoff.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE voice_human_tool_slots,voice_human_handoffs,voice_human_runtimes,voice_calls,contacts,conversations,channel_connections,workspace_members,workspaces,auth.users CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2),($3)',[owner,agent,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent','[\"/voz\"]')",[ws,agent]);await db.query('INSERT INTO contacts VALUES($1,$2)',[contact,ws]);
 await db.query("INSERT INTO voice_calls(id,workspace_id,contact_id,status,direction) VALUES($1,$2,$3,'dialing','outbound')",[call,ws,contact]);
});
describe('Private acknowledged human takeover and tool barrier',()=>{
 it('keeps an immutable media boundary only after acknowledged AI close and tool drain',async()=>{
  await register();await request();expect(await scalar('SELECT voice_human_media_boundary($1)',[call])).toBeNull();await ack();
  const boundary=await scalar('SELECT voice_human_media_boundary($1)',[call]);expect(boundary).toMatchObject({call_id:call});expect(boundary).toHaveProperty('ai_stopped_at');await ack('connected');await ack('ended');expect(await scalar('SELECT voice_human_media_boundary($1)',[call])).toEqual(boundary);
 });
 it('probes the private fixed schema without performing any call operation',async()=>{
  expect(await scalar('SELECT voice_human_handoff_ready()')).toBe(true);
  await db.exec('SET ROLE service_role');expect(await scalar('SELECT voice_human_handoff_ready()')).toBe(true);await db.exec('RESET ROLE');
  for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT voice_human_handoff_ready()')).rejects.toThrow('permission denied');await expect(db.exec('SELECT purge_voice_human_handoffs()')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
 });
 it('purges only old terminal calls and never clears an active tool barrier',async()=>{
  await register();const slot=await scalar('SELECT begin_controlled_voice_tool($1)',[call]);await request();await ack('failed');
  await db.exec("UPDATE voice_human_runtimes SET seen_at=clock_timestamp()-interval '31 days';UPDATE voice_human_handoffs SET ended_at=clock_timestamp()-interval '31 days';UPDATE voice_human_tool_slots SET created_at=clock_timestamp()-interval '31 days'");
  expect(await scalar('SELECT purge_voice_human_handoffs()')).toBe(0);expect(await scalar('SELECT count(*) FROM voice_human_tool_slots')).toBe(1);
  await db.exec("UPDATE voice_calls SET status='completed'");expect(await scalar('SELECT purge_voice_human_handoffs()')).toBe(1);expect(await scalar('SELECT count(*) FROM voice_human_tool_slots')).toBe(0);expect(await scalar('SELECT finish_controlled_voice_tool($1,$2)',[call,slot])).toBe(false);
  await expect(scalar('SELECT purge_voice_human_handoffs(501)')).rejects.toThrow('invalid_voice_handoff');
 });
 it('denies direct table reads and browser execution of control RPCs',async()=>{
  for(const role of ['anon','authenticated','service_role']){await db.exec(`SET ROLE ${role}`);for(const table of ['voice_human_runtimes','voice_human_handoffs','voice_human_tool_slots'])await expect(db.exec('SELECT * FROM '+table)).rejects.toThrow('permission denied');if(role!=='service_role')await expect(register()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
 });
 it('binds runtime to the real outgoing room/customer identity and a single worker nonce',async()=>{
  await expect(register('other_room')).rejects.toThrow('voice_handoff_changed');await expect(register('voice_'+call,'caller-other')).rejects.toThrow('voice_handoff_changed');expect(await register()).toBe(true);
  expect(await register()).toBe(true);await expect(register('voice_'+call,'caller-'+call,other)).rejects.toThrow('voice_handoff_changed');expect(await scalar('SELECT status FROM voice_calls')).toBe('in_progress');
 });
 it('supports exact incoming SIP identities containing plus signs without guessing the room',async()=>{
  await db.query("UPDATE voice_calls SET direction='inbound',external_call_id=$1",['call_fixture:sip_+573001112233']);expect(await register('call_fixture','sip_+573001112233')).toBe(true);
 });
 it('does not request control without a fresh registered worker',async()=>{
  await expect(request()).rejects.toThrow('voice_handoff_unavailable');await register();await db.exec("UPDATE voice_human_runtimes SET seen_at=clock_timestamp()-interval '16 seconds'");await expect(request()).rejects.toThrow('voice_handoff_unavailable');
 });
 it('requires worker ready acknowledgement before a grant and observed join before connected',async()=>{
  await register();const saved=humanHandoffSnapshot.parse(await request());expect(saved.job?.state).toBe('requested');expect(await request()).toEqual(saved);await expect(grant()).rejects.toThrow('voice_handoff_changed');expect(await ack('connected')).toBe(false);
  expect(await ack()).toBe(true);expect(await grant()).toMatchObject({id,room:'voice_'+call,actor_id:owner});expect(humanHandoffSnapshot.parse(await snapshot()).job).toMatchObject({state:'ready',joined_at:null});expect(await ack('connected')).toBe(true);expect(humanHandoffSnapshot.parse(await snapshot()).job?.joined_at).not.toBeNull();
 });
 it('blocks new tools immediately and keeps an in-flight backend tool as a durable barrier',async()=>{
  await register();const slot=await scalar('SELECT begin_controlled_voice_tool($1)',[call]);await request();await expect(scalar('SELECT begin_controlled_voice_tool($1)',[call])).rejects.toThrow('voice_handoff_changed');expect(await poll()).toMatchObject({tools_pending:true});expect(await ack()).toBe(false);
  await db.exec("UPDATE voice_human_tool_slots SET created_at=clock_timestamp()-interval '1 day'");expect(await ack()).toBe(false);
  expect(await scalar('SELECT finish_controlled_voice_tool($1,$2)',[other,slot])).toBe(false);expect(await ack()).toBe(false);expect(await scalar('SELECT finish_controlled_voice_tool($1,$2)',[call,slot])).toBe(true);expect(await ack()).toBe(true);
 });
 it('does not cross tenants/actors or let a second controller replace the first',async()=>{
  await register();await request();await expect(request(other,id,other)).rejects.toThrow('voice_handoff_not_found');await expect(request(agent,other)).rejects.toThrow('voice_handoff_changed');await expect(grant(agent)).rejects.toThrow('voice_handoff_not_found');await expect(ack('ready',other)).rejects.toThrow('voice_handoff_not_found');
 });
 it.each(['role','section','billing','workspace','contact'] as const)('rechecks current %s before granting or renewing',async mode=>{
  await register();await request(agent);await ack();if(mode==='role')await db.exec("UPDATE workspace_members SET role='viewer'");if(mode==='section')await db.exec("UPDATE workspace_members SET allowed_sections='[]'");if(mode==='billing')await db.exec('UPDATE workspaces SET writable=false');if(mode==='workspace')await db.exec('UPDATE workspaces SET deleted_at=clock_timestamp()');if(mode==='contact')await db.query('UPDATE contacts SET workspace_id=$1',[other]);
  await expect(grant(agent)).rejects.toThrow();expect(await ack('connected')).toBe(false);expect(await poll()).toMatchObject({state:'expired'});
 });
 it('keeps personal email conversation ownership even for the workspace owner',async()=>{
  await register();await db.query("INSERT INTO channel_connections VALUES($1,$2,'gmail',$3)",[id,ws,agent]);await db.query("INSERT INTO conversations VALUES($1,$2,NULL,'gmail',$1)",[id,ws]);await db.query('UPDATE voice_calls SET conversation_id=$1',[id]);await expect(request()).rejects.toThrow('voice_handoff_not_found');expect(humanHandoffSnapshot.parse(await request(agent)).job?.actor_id).toBe(agent);
 });
 it('expires abandoned requests rather than allowing late grants or a replacement room',async()=>{
  await register();await request();await db.exec("UPDATE voice_human_handoffs SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second'");expect(await poll()).toMatchObject({state:'expired'});await expect(grant()).rejects.toThrow('voice_handoff_changed');await expect(request(owner,other)).rejects.toThrow('voice_handoff_changed');
 });
 it('renews only a currently connected lease and preserves the actor/result on release',async()=>{
  await register();await request();await ack();await expect(scalar('SELECT manage_voice_human_handoff($1,$2,$3,$4,$5)',[ws,owner,call,id,'renew'])).rejects.toThrow('voice_handoff_changed');await ack('connected');
  expect(humanHandoffSnapshot.parse(await scalar('SELECT manage_voice_human_handoff($1,$2,$3,$4,$5)',[ws,owner,call,id,'renew'])).job?.state).toBe('connected');
  expect(humanHandoffSnapshot.parse(await scalar('SELECT manage_voice_human_handoff($1,$2,$3,$4,$5)',[ws,owner,call,id,'end'])).job).toMatchObject({state:'ended',reason:'ended_by_human'});expect(await ack('connected')).toBe(false);
 });
 it('allows the same actor to release their own lease after permission revocation without exposing context',async()=>{
  await register();await request(agent);await db.exec("UPDATE workspace_members SET role='viewer'");expect(await scalar('SELECT manage_voice_human_handoff($1,$2,$3,$4,$5)',[ws,agent,call,id,'end'])).toEqual({released:true});
 });
});
