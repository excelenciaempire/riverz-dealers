import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
const db=new PGlite();
const ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333';
const action='44444444-4444-4444-8444-444444444444',contact='55555555-5555-4555-8555-555555555555',conv='66666666-6666-4666-8666-666666666666';
const flow='77777777-7777-4777-8777-777777777777',run='88888888-8888-4888-8888-888888888888',other='99999999-9999-4999-8999-999999999999';
const config={action_id:action,action_revision:2,input_vars:{reference:'order'},output_prefix:'system',next_node_key:'end'};
const context={contact_id:contact,conversation_id:conv,phone:null,email:null},vars={order:'123'},visit='2026-10-01T00:00:00Z';
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections text[]);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,phone text,email text);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
 CREATE TABLE approval_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,kind text,title text,body text,payload jsonb,
 contact_id uuid,status text DEFAULT 'pendiente',expires_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),decided_at timestamptz,decided_by uuid,decided_via text,result text);
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT allowed FROM public.billing$$;
 CREATE TABLE flows(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,status text,deleted_at timestamptz);
 CREATE TABLE flow_nodes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),flow_id uuid REFERENCES flows(id) ON DELETE CASCADE,node_key text,node_type text,config jsonb,UNIQUE(flow_id,node_key));
 CREATE TABLE flow_runs(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,flow_id uuid REFERENCES flows(id) ON DELETE CASCADE,
 contact_id uuid,conversation_id uuid,status text,current_node_key text,last_advanced_at timestamptz,vars jsonb,call_stack jsonb DEFAULT '[]',ended_at timestamptz,end_reason text);`);
 for(const file of ['330_http_action_configuration.sql','331_http_action_receipts.sql','337_http_flow_reads.sql','339_http_approval_review_snapshot.sql','341_http_flow_post_approvals.sql','343_http_flow_post_receipt_binding.sql']) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
},30000);
afterAll(async()=>db.close());
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;TRUNCATE workspace_members,contacts,conversations,channel_connections;UPDATE billing SET allowed=true');
 await db.query('INSERT INTO workspaces VALUES($1,$2,NULL)',[ws,owner]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,agent]);
 await db.query('INSERT INTO contacts VALUES($1,$2,NULL,NULL)',[contact,ws]);
 await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',NULL,NULL)",[conv,ws,contact]);
 await db.query("INSERT INTO flows VALUES($1,$2,'active',NULL)",[flow,ws]);
 await db.query("INSERT INTO flow_nodes(flow_id,node_key,node_type,config) VALUES($1,'lookup','http_action',$2),($1,'end','end','{}')",[flow,config]);
 await db.query("INSERT INTO flow_runs(id,workspace_id,flow_id,contact_id,conversation_id,status,current_node_key,last_advanced_at,vars) VALUES($1,$2,$3,$4,$5,'active','start',$6,$7)",[run,ws,flow,contact,conv,visit,vars]);
 await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)",
  [action,ws,{method:'GET',credential_kind:'none',parameters:[{key:'contact',source:'contact_id',required:true,type:'string'}]},owner]);
});
type Receipt={id:string;lease_id?:string;claimed:boolean;state:string};
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const grant=(actor=owner,revision=0,reviewed:unknown=config,operation='save')=>scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,$7)',[ws,actor,flow,operation,'lookup',revision,reviewed]);
const claim=async(options:{node?:string;stamp?:string;input?:unknown;ctx?:unknown;grantRevision?:number;key?:string;flowId?:string}={})=>await scalar(
 'SELECT claim_http_action_flow($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
 [ws,run,options.flowId??flow,'lookup',config,options.grantRevision??1,options.node??'start',options.stamp??visit,options.input??vars,options.key??'a'.repeat(64),'b'.repeat(64),options.ctx??context]) as Receipt;
const finish=(receiptId:string)=>scalar('SELECT finish_http_action_flow($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
 [ws,run,flow,'lookup',config,1,receiptId,visit,vars,{...vars,system_status:'received'}]);
const stop=(stamp=visit,input:unknown=vars,flowId=flow)=>scalar('SELECT fail_http_action_flow($1,$2,$3,$4,$5,$6,$7)',
 [ws,run,flowId,'lookup','start',stamp,input]);
const acknowledged=async()=>{await grant();const r=await claim();await scalar('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7)',[ws,r.id,r.lease_id,'acknowledged',200,null,{status:'received'}]);return r;};
describe('service-only native flow HTTP authorization and receipts',()=>{
 it('records an exact reviewed grant and immutable versions',async()=>{
  expect(await grant()).toMatchObject({state:'active',revision:1,node_config:config});
  expect(await grant(owner,1,config,'withdraw')).toMatchObject({state:'withdrawn',revision:2});
  expect(await scalar('SELECT count(*) FROM http_action_flow_grant_versions')).toBe(2);
 });
 it('rejects an agent and a concurrently changed review',async()=>{
  await expect(grant(agent)).rejects.toThrow('admin_required');await expect(grant(owner,0,{...config,output_prefix:'other'})).rejects.toThrow('changed');
 });
 it('requires the current grant revision',async()=>{await grant();await expect(grant(owner,0)).rejects.toThrow('changed');await expect(claim({grantRevision:2})).rejects.toThrow('changed');});
 it.each(['POST','unscoped','phone'])('rejects %s action authorization',async kind=>{
  const def=kind==='POST'?{method:'POST',parameters:[{source:'contact_id',required:true,type:'string'}]}:
   {method:'GET',parameters:kind==='phone'?[{source:'contact_id',required:true,type:'string'},{source:'phone'}]:[]};
  const reviewed={...config,action_revision:3};
  await db.query('UPDATE http_actions SET definition=$1,revision=3',[def]);
  await db.query('UPDATE flow_nodes SET config=$1 WHERE node_key=$2',[reviewed,'lookup']);
  await expect(grant(owner,0,reviewed)).rejects.toThrow('forbidden');
 });
 it('claims once and returns the durable receipt on a duplicate worker',async()=>{
  await grant();const first=await claim();expect(first.claimed).toBe(true);const second=await claim({node:'lookup'});
  expect(second).toMatchObject({id:first.id,claimed:false,state:'claimed'});expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(1);
 });
 it.each(['node','timestamp','vars'])('rejects stale runtime %s',async kind=>{
  await grant();await expect(claim(kind==='node'?{node:'wrong'}:kind==='timestamp'?{stamp:'2026-10-01T00:01:00Z'}:{input:{order:'other'}})).rejects.toThrow('changed');
  expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(0);
 });
 it('rejects a foreign flow, forged identity and paused run',async()=>{
  await grant();await expect(claim({flowId:other})).rejects.toThrow('context');
  await expect(claim({ctx:{...context,contact_id:other}})).rejects.toThrow('context');
  await db.exec("UPDATE flow_runs SET status='paused_by_agent'");await expect(claim()).rejects.toThrow('changed');
 });
 it('requires the root and active subflow to remain authorized and active',async()=>{
  await grant();await db.exec("UPDATE flows SET status='draft'");await expect(claim()).rejects.toThrow('context');
 });
 it('blocks a withdrawn grant, changed node or changed action before dispatch',async()=>{
  await grant();await grant(owner,1,config,'withdraw');await expect(claim({grantRevision:2})).rejects.toThrow('changed');
 });
 it('requires the grantor current membership and permissions',async()=>{
  await grant();await db.query('UPDATE workspaces SET owner_id=$1',[other]);await expect(claim()).rejects.toThrow('admin_required');
 });
 it('blocks overdue businesses even for automated reads',async()=>{await grant();await db.exec('UPDATE billing SET allowed=false');await expect(claim()).rejects.toThrow('read_only');});
 it('advances and applies outputs once after a recorded provider response',async()=>{
  const r=await acknowledged();expect(await finish(r.id)).toBe(true);expect(await finish(r.id)).toBe(false);
  expect(await scalar('SELECT vars FROM flow_runs')).toEqual({order:'123',system_status:'received'});
  expect(await scalar('SELECT current_node_key FROM flow_runs')).toBe('end');
 });
 it('does not advance an uncertain provider result',async()=>{
  await grant();const r=await claim();await scalar('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7)',[ws,r.id,r.lease_id,'uncertain',null,'http_timeout',null]);
  await expect(finish(r.id)).rejects.toThrow('context');expect(await scalar('SELECT vars FROM flow_runs')).toEqual(vars);
 });
 it('does not publish outputs after a pause or changed authorization',async()=>{
  const r=await acknowledged();await grant(owner,1,config,'withdraw');await expect(finish(r.id)).rejects.toThrow('changed');
  await db.exec("UPDATE flow_runs SET status='paused_by_agent'");expect(await finish(r.id)).toBe(false);
 });
 it('does not publish outputs after editing the graph during the request',async()=>{
  const r=await acknowledged();await db.query('UPDATE flow_nodes SET config=$1 WHERE node_key=$2',[{...config,output_prefix:'other'},'lookup']);
  await expect(finish(r.id)).rejects.toThrow('changed');
 });
 it.each(['moved','deleted','private_mailbox','authority'])('rechecks %s after receiving the HTTP result',async kind=>{
  const r=await acknowledged();
  if(kind==='moved')await db.query('UPDATE conversations SET contact_id=$1',[other]);
  if(kind==='deleted')await db.exec('UPDATE conversations SET deleted_at=clock_timestamp()');
  if(kind==='private_mailbox')await db.exec("UPDATE conversations SET channel='gmail'");
  if(kind==='authority')await db.query('UPDATE workspaces SET owner_id=$1',[other]);
  await expect(finish(r.id)).rejects.toThrow(kind==='authority'?'admin_required':'context');
  expect(await scalar('SELECT vars FROM flow_runs')).toEqual(vars);
 });
 it('executes only the current active subflow with a separate reviewed grant',async()=>{
  await db.query("INSERT INTO flows VALUES($1,$2,'active',NULL)",[other,ws]);
  await db.query("INSERT INTO flow_nodes(flow_id,node_key,node_type,config) VALUES($1,'lookup','http_action',$2)",[other,config]);
  await scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,$7)',[ws,owner,other,'save','lookup',0,config]);
  await db.query('UPDATE flow_runs SET call_stack=$1',[[{flow_id:other,return_to_node_key:'end'}]]);
  expect((await claim({flowId:other})).claimed).toBe(true);
  await db.query("UPDATE flows SET status='draft' WHERE id=$1",[other]);
  await expect(claim({flowId:other,node:'lookup'})).rejects.toThrow('context');
 });
 it('records failure only for the observed visit, once',async()=>{
  await grant();await claim();expect(await stop()).toBe(true);expect(await stop()).toBe(false);
  expect(await scalar('SELECT status FROM flow_runs')).toBe('failed');
  expect(await scalar('SELECT end_reason FROM flow_runs')).toBe('http_flow_review_required');
 });
 it.each(['advanced','timestamp','vars','paused','subflow'])('does not stop a newer %s execution',async kind=>{
  await grant();await claim();
  if(kind==='advanced')await db.exec("UPDATE flow_runs SET current_node_key='end'");
  if(kind==='timestamp')await db.exec("UPDATE flow_runs SET last_advanced_at='2026-10-01T00:02:00Z'");
  if(kind==='vars')await db.query('UPDATE flow_runs SET vars=$1',[{order:'changed'}]);
  if(kind==='paused')await db.exec("UPDATE flow_runs SET status='paused_by_agent'");
  if(kind==='subflow')await db.query('UPDATE flow_runs SET call_stack=$1',[[{flow_id:other,return_to_node_key:'end'}]]);
  expect(await stop()).toBe(false);
 });
 it('gives subsequent suspended visits a new receipt without retrying an old one',async()=>{
  const r=await acknowledged();await finish(r.id);const nextVisit='2026-10-01T00:02:00Z';
  await db.query("UPDATE flow_runs SET current_node_key='start',last_advanced_at=$1,vars=$2",[nextVisit,vars]);
  const next=await claim({stamp:nextVisit,key:'c'.repeat(64)});expect(next.claimed).toBe(true);expect(next.id).not.toBe(r.id);
 });
 it('denies public RPC execution and direct writes',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role);await expect(grant()).rejects.toThrow('permission denied');await expect(claim()).rejects.toThrow('permission denied');
   await expect(stop()).rejects.toThrow('permission denied');
   await expect(db.exec('SELECT * FROM http_action_flow_grants')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');await expect(db.exec("UPDATE http_action_flow_grants SET state='withdrawn'")).rejects.toThrow('permission denied');
 });
});
