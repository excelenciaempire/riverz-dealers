import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {portalSnapshot,publicPortal} from './contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333',
 id='44444444-4444-4444-8444-444444444444',article='55555555-5555-4555-8555-555555555555',source='66666666-6666-4666-8666-666666666666',other='77777777-7777-4777-8777-777777777777';
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const brand={name:'Fixture Shop',description:'Help',accent:'#123456'};
const configure={id,agentId:agent,slug:'fixture-shop',brand,revision:0,published:true};
const draft={id:article,portalId:id,sourceId:source,sourceRevision:2,title:'Returns',body:'Returns within 30 days.',locale:'en',revision:0};
const manage=(action:string,input:unknown,actor=owner,workspace=ws)=>scalar('SELECT manage_help_portal($1,$2,$3,$4)',[workspace,actor,action,JSON.stringify(input)]);
const read=()=>scalar('SELECT read_help_portal($1,$2,$3)',[ws,owner,agent]);
const published=(locale='en')=>scalar('SELECT public_help_portal($1,$2)',['fixture-shop',locale]);
const action=(state='publish',revision=1)=>({id:article,portalId:id,revision,action:state,...(state==='publish'?{reviewed:true}:{})});
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE workspace_subscriptions(workspace_id uuid);CREATE TABLE workspace_billing_invoices(workspace_id uuid);
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),deleted_at timestamptz);
 CREATE TABLE ai_document_sources(id uuid PRIMARY KEY,workspace_id uuid,agent_id uuid,text text,status text,revision integer);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,channel text,external_id text);
 CREATE TABLE orders(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,order_number text,status text,updated_at timestamptz);
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;`);
 await db.exec(readFileSync('supabase/migrations/365_reviewed_help_portals.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/366_help_portal_reported_avoidance.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE orders,contacts,workspaces,workspace_members,ai_agents,ai_document_sources CASCADE');
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$2)',[ws,owner,other]);
 await db.query('INSERT INTO ai_agents VALUES($1,$2,NULL)',[agent,ws]);
 await db.query("INSERT INTO ai_document_sources VALUES($1,$2,$3,'Private staff rule. Returns within 30 days.','active',2)",[source,ws,agent]);
});
async function live(){await manage('configure',configure);await manage('save',draft);await manage('publish',action());}
describe('Reviewed help portal publication and authority',()=>{
 it('does not infer contact avoidance from resolution and records it only after a distinct explicit report',async()=>{
  await live();const report=(resolved:boolean|null,avoided:boolean|null)=>scalar('SELECT record_help_portal_visit($1,$2,$3,$4,$5,$6,$7)',['fixture-shop','en',article,2,other,resolved,avoided]);
  await report(true,null);expect(await scalar('SELECT help_portal_statistics($1,$2,$3)',[ws,owner,agent])).toMatchObject({resolved:1,avoidanceResponded:0,reportedAvoided:0});
  await expect(report(false,true)).rejects.toThrow('portal_invalid');await report(true,true);await report(true,false);
  expect(await scalar('SELECT help_portal_statistics($1,$2,$3)',[ws,owner,agent])).toMatchObject({views:1,resolved:1,avoidanceResponded:1,reportedAvoided:1});
 });
 it('deduplicates a reported read and first feedback without claiming an avoided support ticket',async()=>{
  await live();const visit=(resolved:boolean|null)=>scalar('SELECT record_help_portal_visit($1,$2,$3,$4,$5,$6)',['fixture-shop','en',article,2,other,resolved]);
  await visit(null);await visit(null);await visit(false);await visit(true);
  const stats=await scalar('SELECT help_portal_statistics($1,$2,$3)',[ws,owner,agent]);expect(stats).toMatchObject({views:1,responded:1,resolved:0,needsHelp:1,windowDays:30});
  await db.exec('UPDATE ai_document_sources SET revision=3');await expect(visit(true)).rejects.toThrow('portal_not_found');
  await db.exec("UPDATE help_portal_visits SET expires_at=clock_timestamp()-interval '1 second'");expect(await scalar('SELECT purge_help_portal_visits()')).toBe(1);
  expect(await scalar('SELECT help_portal_statistics($1,$2,$3)',[ws,owner,agent])).toMatchObject({views:0,responded:0,resolved:0,needsHelp:0});
 });
 it('returns the published branded portal only for the bound widget assistant',async()=>{
  await live();expect(await scalar('SELECT widget_help_portal($1,$2,$3)',[ws,agent,'en'])).toEqual(await published());
  expect(await scalar('SELECT widget_help_portal($1,$2,$3)',[other,agent,'en'])).toBeNull();
  expect(await scalar('SELECT widget_help_portal($1,$2,$3)',[ws,other,'en'])).toBeNull();
 });
 it('tracks only the signed visitor exact webchat contact, with no email/phone or provider information',async()=>{
  await db.query("INSERT INTO contacts VALUES($1,$2,'webchat','signed-visitor'),($3,$2,'whatsapp','signed-visitor'),($4,$5,'webchat','signed-visitor')",[source,ws,article,agent,other]);
  await db.query("INSERT INTO orders VALUES($1,$2,$3,'#1','paid',clock_timestamp()),($4,$2,$5,'#2','paid',clock_timestamp()),($6,$7,$8,'#3','paid',clock_timestamp())",[id,ws,source,other,article,owner,other,agent]);
  const result=await scalar('SELECT widget_help_orders($1,$2)',[ws,'signed-visitor']);expect(result).toMatchObject([{id,reference:'#1',status:'paid'}]);
  expect(Object.keys((result as Record<string,unknown>[])[0]).sort()).toEqual(['id','observed_at','reference','status']);
  expect(await scalar('SELECT widget_help_orders($1,$2)',[ws,'guessed-visitor'])).toEqual([]);
  await db.exec("UPDATE contacts SET channel='whatsapp'");expect(await scalar('SELECT widget_help_orders($1,$2)',[ws,'signed-visitor'])).toEqual([]);
 });
 it('keeps private knowledge and drafts out of the public portal until independent review',async()=>{
  expect(await published()).toBeNull();await manage('configure',configure);await manage('save',draft);
  expect(publicPortal.parse(await published()).articles).toEqual([]);
  expect(portalSnapshot.parse(await read()).articles[0]).toMatchObject({status:'draft',revision:1,source_revision:2});
  await expect(manage('publish',{...action(),reviewed:false})).rejects.toThrow('portal_invalid');
  await manage('publish',action());const result=publicPortal.parse(await published());expect(result.articles[0]).toMatchObject({body:draft.body,revision:2});
  expect(JSON.stringify(result)).not.toContain('Private staff');expect(JSON.stringify(result)).not.toContain(source);expect(JSON.stringify(result)).not.toContain(ws);
  expect(publicPortal.parse(await published('es')).articles).toEqual([]);
 });
 it('withdraws stale articles on the next read when the assistant source changes or becomes inactive',async()=>{
  await live();await db.query('UPDATE ai_document_sources SET revision=3 WHERE id=$1',[source]);expect(publicPortal.parse(await published()).articles).toEqual([]);
  await expect(manage('publish',action('publish',2))).rejects.toThrow('portal_source_changed');
  await db.exec("UPDATE ai_document_sources SET revision=2,status='withdrawn'");expect(publicPortal.parse(await published()).articles).toEqual([]);
  await db.exec('DELETE FROM ai_document_sources');expect(portalSnapshot.parse(await read()).articles).toEqual([]);
 });
 it('requires an exact literal excerpt of an active version belonging to this assistant',async()=>{
  await manage('configure',configure);
  for(const patch of [{body:'Invented policy'},{sourceRevision:1},{sourceId:other}])await expect(manage('save',{...draft,...patch})).rejects.toThrow('portal_source_changed');
  await db.query('UPDATE ai_document_sources SET agent_id=$1',[other]);await expect(manage('save',draft)).rejects.toThrow('portal_source_changed');
 });
 it('makes every edit a draft and rejects stale editor revisions without overwriting',async()=>{
  await live();await manage('save',{...draft,revision:2,title:'Reviewed returns'});
  expect(publicPortal.parse(await published()).articles).toEqual([]);
  await expect(manage('save',{...draft,revision:2})).rejects.toThrow('portal_changed');
  expect(portalSnapshot.parse(await read()).articles[0]).toMatchObject({title:'Reviewed returns',status:'draft',revision:3});
  await expect(manage('configure',{...configure,revision:0})).rejects.toThrow('portal_changed');
 });
 it('allows current owner or scoped admin and rejects revoked, agent or excluded administrators',async()=>{
  for(const role of ['agent','admin']){
   await db.query("INSERT INTO workspace_members VALUES($1,$2,$3,'[\"/contactos\"]')",[ws,other,role]);
   await expect(manage('configure',configure,other)).rejects.toThrow('portal_not_found');await db.exec('DELETE FROM workspace_members');
  }
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin','[\"/asistente\"]')",[ws,other]);await manage('configure',configure,other);
  await db.exec('DELETE FROM workspace_members');await expect(manage('configure',{...configure,revision:1},other)).rejects.toThrow('portal_not_found');
  await expect(manage('configure',configure,owner,other)).rejects.toThrow('portal_not_found');
 });
 it('blocks publication during read-only billing and hides deleted assistants/businesses',async()=>{
  await live();await db.exec('UPDATE workspaces SET writable=false');await expect(manage('publish',action('publish',2))).rejects.toThrow('portal_read_only');
  await db.exec('UPDATE ai_agents SET deleted_at=clock_timestamp()');expect(await published()).toBeNull();
  await db.exec('UPDATE ai_agents SET deleted_at=NULL;UPDATE workspaces SET deleted_at=clock_timestamp()');expect(await published()).toBeNull();
 });
 it('requires explicit withdrawal and portal visibility, without deleting the assistant source',async()=>{
  await live();await manage('withdraw',action('withdraw',2));expect(publicPortal.parse(await published()).articles).toEqual([]);
  await manage('publish',action('publish',3));await manage('configure',{...configure,revision:1,published:false});expect(await published()).toBeNull();
  expect(await scalar('SELECT status FROM ai_document_sources')).toBe('active');
 });
 it('rejects forged scope/publish fields, unsafe brand CSS and malformed IDs at the SQL boundary',async()=>{
  await manage('configure',configure);
  await expect(manage('save',{...draft,workspace_id:other})).rejects.toThrow('portal_invalid');
  await expect(manage('save',{...draft,status:'published'})).rejects.toThrow('portal_invalid');
  await expect(manage('configure',{...configure,revision:1,brand:{...brand,accent:'url(https://private)'}})).rejects.toThrow('portal_invalid');
  await expect(manage('save',{...draft,id:'invalid'})).rejects.toThrow('portal_invalid');
 });
 it('caps stored excerpts and denies direct tables and public/client RPC execution',async()=>{
  await manage('configure',configure);await db.exec("UPDATE ai_document_sources SET text=repeat('a',20000)");
  for(let n=0;n<3;n++)await manage('save',{...draft,id:`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`,body:'a'.repeat(16000)});
  await expect(manage('save',{...draft,body:'a'})).rejects.toThrow('portal_limit');
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM help_portals')).rejects.toThrow('permission denied');
   await expect(db.exec('SELECT * FROM help_portal_articles')).rejects.toThrow('permission denied');
   await expect(db.exec('SELECT * FROM help_portal_visits')).rejects.toThrow('permission denied');
   if(role!=='service_role')await expect(published()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  }
 });
 it('has a private invoker readiness probe with fixed search paths and no public widget RPCs',async()=>{
  expect(await scalar('SELECT help_portal_ready()')).toBe(true);
  expect(await scalar("SELECT has_function_privilege('anon','widget_help_orders(uuid,text)','execute')")).toBe(false);
  expect(await scalar("SELECT has_function_privilege('authenticated','record_help_portal_visit(text,text,uuid,integer,uuid,boolean)','execute')")).toBe(false);
  expect(await scalar("SELECT NOT prosecdef AND proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='help_portal_ready()'::regprocedure")).toBe(true);
 });
});
