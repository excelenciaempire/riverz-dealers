import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',contact='44444444-4444-4444-8444-444444444444';
const conv='55555555-5555-4555-8555-555555555555',flow='66666666-6666-4666-8666-666666666666',run='77777777-7777-4777-8777-777777777777',connection='88888888-8888-4888-8888-888888888888';
const from='2026-09-01T00:00:00Z',through='2026-10-01T00:00:00Z';
type Result={total_runs:number;node_entries:number;by_node:Record<string,number>;by_status:Record<string,number>;matched_runs:number;records:{id:string;started_at:string}[];next_cursor:{id:string;started_at:string}|null};
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const read=(who=actor,node:string|null=null,status:string|null=null,cursor:unknown=null)=>scalar('SELECT read_flow_metric_evidence($1,$2,$3,$4,$5,$6,$7,$8)',[ws,who,flow,from,through,node,status,cursor]) as Promise<Result>;
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE flows(id uuid PRIMARY KEY,workspace_id uuid,deleted_at timestamptz);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,connection_id uuid,channel text,deleted_at timestamptz);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
 CREATE TABLE flow_runs(id uuid PRIMARY KEY,workspace_id uuid,flow_id uuid,conversation_id uuid,contact_id uuid,status text,started_at timestamptz,ended_at timestamptz);
 CREATE TABLE flow_run_events(id uuid PRIMARY KEY,flow_run_id uuid,event_type text,node_key text,created_at timestamptz,payload jsonb);
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/357_flow_metric_evidence.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces,workspace_members,flows,contacts,conversations,channel_connections,flow_runs,flow_run_events');
 await db.query('INSERT INTO workspaces VALUES($1,$2,NULL),($3,$3,NULL)',[ws,actor,other]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL),($1,$3,'agent',NULL)",[ws,actor,other]);
 await db.query('INSERT INTO flows VALUES($1,$2,NULL)',[flow,ws]);await db.query('INSERT INTO contacts VALUES($1,$2)',[contact,ws]);await db.query("INSERT INTO channel_connections VALUES($1,$2,'webchat',$3)",[connection,ws,actor]);
 await db.query("INSERT INTO conversations VALUES($1,$2,$3,$4,'webchat',NULL)",[conv,ws,contact,connection]);
 await db.query("INSERT INTO flow_runs VALUES($1,$2,$3,$4,$5,'completed','2026-09-15T12:00:00.123456Z','2026-09-15T12:01:00Z')",[run,ws,flow,conv,contact]);
 await db.query("INSERT INTO flow_run_events VALUES(gen_random_uuid(),$1,'node_entered','start','2026-09-15T12:00:00.123456Z','{\"secret\":\"DO_NOT_SERIALIZE\"}'),(gen_random_uuid(),$1,'node_entered','start','2026-09-15T12:00:01Z','{}'),(gen_random_uuid(),$1,'completed',NULL,'2026-09-15T12:01:00Z','{}')",[run]);
});
describe('Complete authorized flow counts and paged source evidence',()=>{
 it('keeps the aggregate and guard private with fixed search paths',async()=>{expect(await scalar('SELECT flow_metric_evidence_ready()')).toBe(true);for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await expect(read()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}});
 it('counts recorded visits separately from runs and excludes payloads',async()=>{const value=await read();expect(value).toMatchObject({total_runs:1,node_entries:2,by_node:{start:2},by_status:{completed:1},matched_runs:1,next_cursor:null});expect(JSON.stringify(value)).not.toContain('DO_NOT_SERIALIZE');expect(value.records[0].started_at).toContain('123456');});
 it('does not truncate cohorts or entries after a REST page',async()=>{await db.query('INSERT INTO flow_runs SELECT gen_random_uuid(),r.workspace_id,r.flow_id,r.conversation_id,r.contact_id,r.status,r.started_at,r.ended_at FROM flow_runs r CROSS JOIN generate_series(1,1102) WHERE r.id=$1',[run]);await db.exec("INSERT INTO flow_run_events SELECT gen_random_uuid(),r.id,'node_entered','start',r.started_at,'{}'::jsonb FROM flow_runs r WHERE NOT EXISTS(SELECT 1 FROM flow_run_events e WHERE e.flow_run_id=r.id)");const value=await read();expect(value.total_runs).toBe(1103);expect(value.node_entries).toBe(1104);expect(value.records).toHaveLength(20);expect(value.next_cursor).not.toBeNull();});
 it('paginates shared timestamps without truncating microseconds or repeating IDs',async()=>{await db.query('INSERT INTO flow_runs SELECT gen_random_uuid(),r.workspace_id,r.flow_id,r.conversation_id,r.contact_id,r.status,r.started_at,r.ended_at FROM flow_runs r CROSS JOIN generate_series(1,42) WHERE r.id=$1',[run]);const first=await read(),second=await read(actor,null,null,first.next_cursor),third=await read(actor,null,null,second.next_cursor);expect(first.next_cursor?.started_at).toContain('123456');const ids=[...first.records,...second.records,...third.records].map(row=>row.id);expect(ids).toHaveLength(43);expect(new Set(ids).size).toBe(43);expect(third.next_cursor).toBeNull();});
 it('filters source runs without turning repeated visits into distinct customers',async()=>{expect(await read(actor,'start')).toMatchObject({total_runs:1,node_entries:2,matched_runs:1});expect(await read(actor,'missing')).toMatchObject({total_runs:1,node_entries:2,matched_runs:0,records:[]});expect(await read(actor,null,'failed')).toMatchObject({total_runs:1,matched_runs:0});});
 it('uses an inclusive start and exclusive end for runs and event times',async()=>{await db.query('UPDATE flow_runs SET started_at=$1',[from]);await db.query("INSERT INTO flow_run_events VALUES(gen_random_uuid(),$1,'node_entered','boundary',$2,'{}')",[run,through]);expect(await read()).toMatchObject({total_runs:1,node_entries:2});await db.query('UPDATE flow_runs SET started_at=$1',[through]);expect(await read()).toMatchObject({total_runs:0,node_entries:0,records:[]});});
 it.each(['contact_workspace','contact_mismatch','case_workspace','deleted_case','connection_workspace','connection_channel','run_workspace'])('excludes incoherent source %s',async kind=>{
  if(kind==='contact_workspace')await db.query('UPDATE contacts SET workspace_id=$1',[other]);if(kind==='contact_mismatch')await db.query('UPDATE conversations SET contact_id=$1',[other]);if(kind==='case_workspace')await db.query('UPDATE conversations SET workspace_id=$1',[other]);if(kind==='deleted_case')await db.exec('UPDATE conversations SET deleted_at=now()');if(kind==='connection_workspace')await db.query('UPDATE channel_connections SET workspace_id=$1',[other]);if(kind==='connection_channel')await db.exec("UPDATE channel_connections SET channel='gmail'");if(kind==='run_workspace')await db.query('UPDATE flow_runs SET workspace_id=$1',[other]);expect(await read()).toMatchObject({total_runs:0,node_entries:0,records:[]});
 });
 it('masks personal email counts and drill-down even from another workspace administrator',async()=>{await db.exec("UPDATE conversations SET channel='gmail';UPDATE channel_connections SET channel='gmail';UPDATE workspace_members SET role='admin'");expect(await read(other)).toMatchObject({total_runs:0,node_entries:0,matched_runs:0,records:[]});expect(await read()).toMatchObject({total_runs:1});});
 it.each(['revoked','section','deleted_workspace','deleted_flow','foreign_flow'])('rejects invalid actor/flow scope %s',async kind=>{await db.query('UPDATE workspaces SET owner_id=$1 WHERE id=$2',[other,ws]);if(kind==='revoked')await db.query('DELETE FROM workspace_members WHERE user_id=$1',[actor]);if(kind==='section')await db.exec(`UPDATE workspace_members SET allowed_sections='["/menus"]'`);if(kind==='deleted_workspace')await db.exec('UPDATE workspaces SET deleted_at=now()');if(kind==='deleted_flow')await db.exec('UPDATE flows SET deleted_at=now()');if(kind==='foreign_flow')await db.query('UPDATE flows SET workspace_id=$1',[other]);await expect(read()).rejects.toThrow('flow_metrics_not_found');});
 it.each([{id:run,started_at:'infinity'},{id:run,started_at:from,actor_id:actor},{id:'not-a-uuid',started_at:from}])('rejects malformed or authority-bearing cursors',async cursor=>{await expect(read(actor,null,null,cursor)).rejects.toThrow('invalid_flow_metrics');});
 it('rejects reversed and excessively large periods rather than clamping them silently',async()=>{await expect(scalar('SELECT read_flow_metric_evidence($1,$2,$3,$4,$5)',[ws,actor,flow,through,from])).rejects.toThrow('invalid_flow_metrics');await expect(scalar('SELECT read_flow_metric_evidence($1,$2,$3,$4,$5)',[ws,actor,flow,'2025-01-01T00:00:00Z',through])).rejects.toThrow('invalid_flow_metrics');});
});
