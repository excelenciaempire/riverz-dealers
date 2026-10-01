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
 CREATE TABLE approval_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,kind text,title text,body text,payload jsonb,contact_id uuid,status text DEFAULT 'pendiente',expires_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),decided_at timestamptz,decided_by uuid,decided_via text,result text);
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
 await db.exec('RESET ROLE;TRUNCATE workspaces CASCADE;TRUNCATE workspace_members,contacts,conversations,channel_connections,approval_requests CASCADE;UPDATE billing SET allowed=true');
 await db.query('INSERT INTO workspaces VALUES($1,$2,NULL)',[ws,owner]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,agent]);
 await db.query('INSERT INTO contacts VALUES($1,$2,NULL,NULL)',[contact,ws]);
 await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',NULL,NULL)",[conv,ws,contact]);
 await db.query("INSERT INTO flows VALUES($1,$2,'active',NULL)",[flow,ws]);
 await db.query("INSERT INTO flow_nodes(flow_id,node_key,node_type,config) VALUES($1,'lookup','http_action',$2),($1,'end','end','{}')",[flow,config]);
 await db.query("INSERT INTO flow_runs(id,workspace_id,flow_id,contact_id,conversation_id,status,current_node_key,last_advanced_at,vars) VALUES($1,$2,$3,$4,$5,'active','start',$6,$7)",[run,ws,flow,contact,conv,visit,vars]);
 await db.query("INSERT INTO http_actions(id,workspace_id,definition,state,revision,actor_id) VALUES($1,$2,$3,'active',2,$4)",
  [action,ws,{name:'Submit request',method:'POST',credential_kind:'none',parameters:[{key:'contact',source:'contact_id',required:true,type:'string'},{key:'conversation',source:'conversation_id',required:true,type:'string'},{key:'reference',source:'input',required:true,type:'string'}],outputs:[{key:'status',type:'string',required:true}]},owner]);
});
type Proposal={approval_id:string;status:string;receipt:null|{id:string;state:string};invocation_key:string};
type Claim={claim:{id:string;lease_id?:string;claimed:boolean;state:string};invocation_key:string};
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const grant=()=>scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,$7)',[ws,owner,flow,'save','lookup',0,config]);
const prepare=(node='start',input:unknown=vars,hash='b'.repeat(64),locale='en')=>scalar('SELECT prepare_http_flow_post($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
 [ws,run,flow,'lookup',config,1,node,visit,input,hash,locale]) as Promise<Proposal>;
const propose=async()=>{await grant();return prepare();};
const decide=(id:string,decision='aprobada',actor=owner)=>db.query("UPDATE approval_requests SET status=$1,decided_by=$2,decided_at=clock_timestamp(),decided_via='panel' WHERE id=$3",[decision,actor,id]);
const claim=(id:string,actor=owner,hash='b'.repeat(64))=>scalar('SELECT claim_http_flow_post($1,$2,$3,$4)',[ws,id,actor,hash]) as Promise<Claim>;
const finish=(id:string,output:unknown={...vars,system_status:'received'})=>scalar('SELECT finish_http_flow_post($1,$2,$3)',[ws,id,output]);
const acknowledged=async()=>{const p=await propose();await decide(p.approval_id);const c=await claim(p.approval_id);
 await scalar('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7)',[ws,c.claim.id,c.claim.lease_id,'acknowledged',200,null,{status:'received'}]);return {p,c};};

describe('native POST operations require an immutable per-visit panel decision',()=>{
 it('guards exact receipt binding through private deployment metadata',async()=>{
  expect(await scalar('SELECT http_flow_post_receipt_binding_ready()')).toBe(true);await db.exec('SET ROLE authenticated');
  await expect(db.exec('SELECT http_flow_post_receipt_binding_ready()')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('never observes or applies an old response after approval deletion and recreation',async()=>{
  const {p,c}=await acknowledged();await db.query('DELETE FROM approval_requests WHERE id=$1',[p.approval_id]);
  const newer=await prepare('lookup');expect(newer.approval_id).not.toBe(p.approval_id);expect(newer.receipt).toBe(null);
  await decide(newer.approval_id);expect((await prepare('lookup')).receipt).toBe(null);
  await expect(finish(newer.approval_id)).rejects.toThrow('review_required');
  expect(await scalar('SELECT vars FROM flow_runs')).toEqual(vars);expect(await scalar('SELECT id FROM http_action_runs')).toBe(c.claim.id);
 });
 it.each(['invocation_key','input_hash','actor_id','conversation_id','action_revision'])('rejects a receipt with mismatched %s',async field=>{
  const {p}=await acknowledged();const value=field==='action_revision'?3:field.endsWith('_id')?other:'c'.repeat(64);
  await db.query(`UPDATE http_action_runs SET ${field}=$1`,[value]);expect((await prepare('lookup')).receipt).toBe(null);
  await expect(finish(p.approval_id)).rejects.toThrow('review_required');expect(await scalar('SELECT vars FROM flow_runs')).toEqual(vars);
 });
 it('checks service-only RPCs and RLS through metadata without reading customer rows',async()=>{
  expect(await scalar('SELECT http_flow_post_ready()')).toBe(true);await db.exec('SET ROLE authenticated');
  await expect(db.exec('SELECT http_flow_post_ready()')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  await db.exec('ALTER TABLE http_action_flow_approvals DISABLE ROW LEVEL SECURITY');
  expect(await scalar('SELECT http_flow_post_ready()')).toBe(false);await db.exec('ALTER TABLE http_action_flow_approvals ENABLE ROW LEVEL SECURITY');
 });
 it('prepares exact scoped review and parks without creating a dispatch receipt',async()=>{
  const p=await propose();expect(p).toMatchObject({status:'pendiente',receipt:null});
  expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(0);
  expect(await scalar('SELECT current_node_key FROM flow_runs')).toBe('lookup');
  const payload=await scalar('SELECT payload FROM approval_requests') as Record<string,unknown>;
  expect(payload).toMatchObject({input:{reference:'123'},contact_id:contact,conversation_id:conv,http_action_context:context});
  expect(payload).not.toHaveProperty('agent_id');expect(payload).not.toHaveProperty('confirmed');
  expect(await scalar('SELECT body FROM approval_requests')).toContain('Review this operation');
 });
 it('reuses the same proposal without extending expiry or authorizing transport',async()=>{
  const p=await propose(),expiry=await scalar('SELECT expires_at FROM approval_requests');
  expect(await prepare('lookup')).toEqual(p);expect(await scalar('SELECT count(*) FROM approval_requests')).toBe(1);
  expect(await scalar('SELECT expires_at FROM approval_requests')).toEqual(expiry);await expect(claim(p.approval_id)).rejects.toThrow('review_required');
 });
 it.each(['missing_conversation','optional_conversation','email','unscoped'])('does not grant a %s POST',async kind=>{
  const definition=await scalar('SELECT definition FROM http_actions') as {parameters:Array<{source:string;required:boolean}>};
  if(kind==='missing_conversation')definition.parameters=definition.parameters.filter(p=>p.source!=='conversation_id');
  if(kind==='optional_conversation')definition.parameters.find(p=>p.source==='conversation_id')!.required=false;
  if(kind==='unscoped')definition.parameters=definition.parameters.filter(p=>p.source!=='contact_id');
  if(kind==='email')definition.parameters.push({source:'email',required:false});
  await db.query('UPDATE http_actions SET definition=$1,revision=3',[definition]);
  const revised={...config,action_revision:3};await db.query('UPDATE flow_nodes SET config=$1 WHERE node_key=$2',[revised,'lookup']);
  await expect(scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,$7)',[ws,owner,flow,'save','lookup',0,revised])).rejects.toThrow('forbidden');
 });
 it.each([{}, {order:null}, {order:123}, {order:{}}, {order:'x'.repeat(2001)}])('rejects missing or wrongly typed free inputs: %s',async input=>{
  await grant();await db.query('UPDATE flow_runs SET vars=$1',[input]);await expect(prepare('start',input)).rejects.toThrow('input_invalid');
  expect(await scalar('SELECT count(*) FROM approval_requests')).toBe(0);
 });
 it('does not recycle an expired pending proposal',async()=>{
  await grant();await db.exec("UPDATE flow_runs SET last_advanced_at=clock_timestamp()-interval '2 days'");
  const stamp=await scalar('SELECT last_advanced_at::text FROM flow_runs');
  const snapshot=await scalar('SELECT http_flow_post_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,run,flow,'lookup',config,1,stamp,vars,'start']) as Record<string,unknown>;
  const key='expired';const row=(await db.query<{id:string}>("INSERT INTO approval_requests(workspace_id,kind,title,body,payload,contact_id,expires_at) VALUES($1,'herramienta','Expired','Exact',$2,$3,clock_timestamp()-interval '1 day') RETURNING id",[ws,{...snapshot,dedupe_key:key},contact])).rows[0];
  await db.query('INSERT INTO http_action_flow_approvals VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10)',[ws,run,flow,'lookup',stamp,row.id,config,vars,'b'.repeat(64),'a'.repeat(64)]);
  await expect(scalar('SELECT prepare_http_flow_post($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)',[ws,run,flow,'lookup',config,'start',stamp,vars,'b'.repeat(64),'en'])).rejects.toThrow('review_required');
  expect(await scalar('SELECT count(*) FROM approval_requests')).toBe(1);
 });
 it('freezes the reviewed payload and preserves dedupe after rejection',async()=>{
  const p=await propose();await expect(db.exec("UPDATE approval_requests SET body='new operation'")).rejects.toThrow('snapshot_changed');
  await decide(p.approval_id,'rechazada');expect(await prepare('lookup')).toMatchObject({approval_id:p.approval_id,status:'rechazada'});
  await expect(claim(p.approval_id)).rejects.toThrow('review_required');expect(await scalar('SELECT count(*) FROM approval_requests')).toBe(1);
 });
 it('validates pending authority and snapshot before consuming the decision',async()=>{
  const p=await propose();expect(await scalar('SELECT review_http_flow_post($1,$2,$3,NULL)',[ws,p.approval_id,owner])).toMatchObject({approval_id:p.approval_id});
  await db.query('UPDATE contacts SET email=$1',['changed@example.com']);
  await expect(scalar('SELECT review_http_flow_post($1,$2,$3,NULL)',[ws,p.approval_id,owner])).rejects.toThrow('review_required');
  expect(await scalar('SELECT status FROM approval_requests')).toBe('pendiente');
 });
 it.each(['agent','missing_approvals','foreign_workspace','wrong_actor'])('rejects %s decision context',async kind=>{
  const p=await propose();let who=owner;
  if(kind==='agent')who=agent;
  if(kind==='missing_approvals'){who=other;await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',ARRAY['/automatizaciones','/bandeja'])",[ws,other]);}
  await decide(p.approval_id,'aprobada',who);
  if(kind==='wrong_actor')who=other;
  await expect(kind==='foreign_workspace'?scalar('SELECT claim_http_flow_post($1,$2,$3,$4)',[other,p.approval_id,who,'b'.repeat(64)]):claim(p.approval_id,who)).rejects.toThrow();
  expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(0);
 });
 it.each(['vars','cursor','visit','node','action','grant','contact','phone','email','mailbox','deleted_conversation','billing','root','authority'])('blocks changed %s before transport',async kind=>{
  const p=await propose();await decide(p.approval_id);
  if(kind==='vars')await db.query('UPDATE flow_runs SET vars=$1',[{order:'changed'}]);
  if(kind==='cursor')await db.exec("UPDATE flow_runs SET current_node_key='end'");
  if(kind==='visit')await db.exec("UPDATE flow_runs SET last_advanced_at=clock_timestamp()");
  if(kind==='node')await db.query('UPDATE flow_nodes SET config=$1 WHERE node_key=$2',[{...config,output_prefix:'other'},'lookup']);
  if(kind==='action')await db.exec('UPDATE http_actions SET revision=3');
  if(kind==='grant')await scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,NULL)',[ws,owner,flow,'withdraw','lookup',1]);
  if(kind==='contact')await db.query('UPDATE conversations SET contact_id=$1',[other]);
  if(kind==='phone')await db.exec("UPDATE contacts SET phone='+10000000000'");
  if(kind==='email')await db.exec("UPDATE contacts SET email='changed@example.com'");
  if(kind==='mailbox')await db.exec("UPDATE conversations SET channel='gmail'");
  if(kind==='deleted_conversation')await db.exec('UPDATE conversations SET deleted_at=clock_timestamp()');
  if(kind==='billing')await db.exec('UPDATE billing SET allowed=false');
  if(kind==='root')await db.exec("UPDATE flows SET status='draft'");
  if(kind==='authority')await db.query('UPDATE workspaces SET owner_id=$1',[other]);
  await expect(claim(p.approval_id)).rejects.toThrow();expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(0);
 });
 it('requires both current approver and grantor to own a private mailbox',async()=>{
  await db.query("INSERT INTO channel_connections VALUES($1,$2,'gmail',$3)",[other,ws,owner]);
  await db.query("UPDATE conversations SET channel='gmail',connection_id=$1",[other]);
  const p=await propose();await db.query("UPDATE workspace_members SET role='admin',allowed_sections=NULL WHERE user_id=$1",[agent]);
  await decide(p.approval_id,'aprobada',agent);await expect(claim(p.approval_id,agent)).rejects.toThrow('context');
 });
 it('ties the human receipt to the actual decider and reuses it without another lease',async()=>{
  const p=await propose();await decide(p.approval_id);const first=await claim(p.approval_id),second=await claim(p.approval_id);
  expect(first.claim.claimed).toBe(true);expect(second.claim).toMatchObject({claimed:false,id:first.claim.id,state:'claimed'});
  expect(second.invocation_key).toBe(first.invocation_key);
  expect(await scalar('SELECT actor_id FROM http_action_runs')).toBe(owner);
  expect(await scalar('SELECT count(*) FROM http_action_flow_receipts')).toBe(1);
  await expect(claim(p.approval_id,owner,'c'.repeat(64))).rejects.toThrow('changed');
 });
 it('does not claim a new operation five minutes after the protected decision',async()=>{
  const p=await propose();await db.query("UPDATE approval_requests SET status='aprobada',decided_by=$1,decided_at=clock_timestamp()-interval '6 minutes',decided_via='panel'",[owner]);
  await expect(claim(p.approval_id)).rejects.toThrow('review_required');expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(0);
 });
 it('advances with selected receipt outputs once and rejects arbitrary variable injection',async()=>{
  const {p}=await acknowledged();await expect(finish(p.approval_id,{...vars,system_status:'forged'})).rejects.toThrow('output_invalid');
  expect(await finish(p.approval_id)).toBe(true);await expect(finish(p.approval_id)).rejects.toThrow('changed');
  expect(await scalar('SELECT vars FROM flow_runs')).toEqual({order:'123',system_status:'received'});
 });
 it.each(['identity','grant','approver','billing','paused'])('rechecks %s after the provider response',async kind=>{
  const {p}=await acknowledged();
  if(kind==='identity')await db.exec("UPDATE contacts SET phone='+10000000000'");
  if(kind==='grant')await scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,NULL)',[ws,owner,flow,'withdraw','lookup',1]);
  if(kind==='approver')await db.query('UPDATE workspaces SET owner_id=$1',[other]);
  if(kind==='billing')await db.exec('UPDATE billing SET allowed=false');
  if(kind==='paused')await db.exec("UPDATE flow_runs SET status='paused_by_agent'");
  await expect(finish(p.approval_id)).rejects.toThrow();expect(await scalar('SELECT vars FROM flow_runs')).toEqual(vars);
 });
 it('stops rejected and uncertain operations without touching a newer visit',async()=>{
  const p=await propose();await decide(p.approval_id,'rechazada');expect(await scalar('SELECT reject_http_flow_post($1,$2,$3)',[ws,p.approval_id,owner])).toBe(true);
  expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(0);
  await db.query("UPDATE flow_runs SET status='active',last_advanced_at=clock_timestamp(),vars=$1",[vars]);
  expect(await scalar('SELECT reject_http_flow_post($1,$2,$3)',[ws,p.approval_id,owner])).toBe(false);
 });
 it('stops an uncertain acknowledged decision while retaining its receipt and prohibiting replay',async()=>{
  const p=await propose();await decide(p.approval_id);const c=await claim(p.approval_id);
  await scalar('SELECT finish_http_action($1,$2,$3,$4,$5,$6,$7)',[ws,c.claim.id,c.claim.lease_id,'uncertain',null,'http_timeout',null]);
  await expect(finish(p.approval_id)).rejects.toThrow('review_required');
  expect(await scalar('SELECT stop_http_flow_post($1,$2,$3)',[ws,p.approval_id,owner])).toBe(true);
  await expect(claim(p.approval_id)).rejects.toThrow('changed');expect(await scalar('SELECT count(*) FROM http_action_runs')).toBe(1);
 });
 it('preserves legacy GET authorization and prohibits the read-only claim for POST',async()=>{
  await grant();await expect(scalar('SELECT claim_http_action_flow($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   [ws,run,flow,'lookup',config,1,'start',visit,vars,'a'.repeat(64),'b'.repeat(64),context])).rejects.toThrow('changed');
  await db.exec("UPDATE http_actions SET definition=jsonb_set(definition,'{method}','\"GET\"'),revision=3");
  const revised={...config,action_revision:3};await db.query('UPDATE flow_nodes SET config=$1 WHERE node_key=$2',[revised,'lookup']);
  expect(await scalar('SELECT manage_http_flow_grant($1,$2,$3,$4,$5,$6,$7)',[ws,owner,flow,'save','lookup',1,revised])).toMatchObject({revision:2});
 });
 it('denies direct table access and RPC execution to public clients',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role);await expect(prepare()).rejects.toThrow('permission denied');
   await expect(claim(other)).rejects.toThrow('permission denied');await expect(finish(other)).rejects.toThrow('permission denied');
   await expect(db.exec('SELECT * FROM http_action_flow_approvals')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');await expect(db.exec('DELETE FROM http_action_flow_approvals')).rejects.toThrow('permission denied');
 });
});
