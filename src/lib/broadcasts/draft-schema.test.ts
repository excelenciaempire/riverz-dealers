import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
const db = new PGlite()
const ws='11111111-1111-4111-8111-111111111111', other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', owner='22222222-2222-4222-8222-222222222222', member='33333333-3333-4333-8333-333333333333', bid='44444444-4444-4444-8444-444444444444', contact='55555555-5555-4555-8555-555555555555', tpl='88888888-8888-4888-8888-888888888888'
const version='2026-10-01T12:00:00Z'
const template={ id:tpl,name:'hello',language:'es',category:'Utility',status:'Approved',body_text:'Hi {{1}}',header_type:null,header_content:null,footer_text:null,buttons:null,waba_id:'waba',user_id:owner }
const config={ name:'Edited',template_name:'hello',template_language:'es',voice_note:null,template_variables:{'1':{type:'static',value:'Ana'}},variable_mapping:null,audience_filter:{type:'all'},scheduled_at:null,create_conversations:true }
const recipients=[{contact_id:contact,params:['Ana']}]
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,suspended_at timestamptz,motor_apagado_at timestamptz);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
 CREATE TABLE broadcasts(id uuid PRIMARY KEY,workspace_id uuid,user_id uuid,name text,status text,updated_at timestamptz,template_name text,template_language text,voice_note jsonb,template_variables jsonb,variable_mapping jsonb,audience_filter jsonb,scheduled_at timestamptz,create_conversations boolean,total_recipients integer,sent_count integer,delivered_count integer,read_count integer,replied_count integer,failed_count integer,error_message text);
 CREATE TABLE broadcast_recipients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),broadcast_id uuid,contact_id uuid,status text,params jsonb,whatsapp_message_id text);
 CREATE TABLE broadcast_delivery_receipts(broadcast_id uuid);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,opted_out boolean);
 CREATE TABLE contact_tags(contact_id uuid,tag_id uuid);
 CREATE TABLE message_templates(id uuid PRIMARY KEY,workspace_id uuid,name text,language text,category text,status text,body_text text,header_type text,header_content text,footer_text text,buttons jsonb,waba_id text,user_id uuid);
 CREATE TABLE whatsapp_config(workspace_id uuid,status text,waba_id text);
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;`)
 const sql=readFileSync('supabase/migrations/325_broadcast_editable_drafts.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces,workspace_members,broadcasts,broadcast_recipients,broadcast_delivery_receipts,contacts,contact_tags,message_templates,whatsapp_config;UPDATE billing SET allowed=true')
 await db.query('INSERT INTO workspaces(id) VALUES($1),($2)',[ws,other]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'agent')",[ws,owner,member])
 await db.query("INSERT INTO broadcasts(id,workspace_id,user_id,name,status,updated_at,template_name,template_language,sent_count) VALUES($1,$2,$3,'Old','draft',$4,'hello','es',0)",[bid,ws,owner,version])
 await db.query('INSERT INTO contacts VALUES($1,$2,false)',[contact,ws]);await db.query("INSERT INTO whatsapp_config VALUES($1,'connected','waba')",[ws])
 await db.query("INSERT INTO message_templates VALUES($1,$2,'hello','es','Utility','Approved','Hi {{1}}',NULL,NULL,NULL,NULL,'waba',$3)",[tpl,ws,owner])
})
type Result={id:string;updated_at:string;total_recipients:number;status:string}
async function save(actor=owner, workspace=ws, data:unknown=config, list:unknown=recipients, expected=version) {
 return (await db.query<{result:Result}>('SELECT save_broadcast_draft($1,$2,$3,$4,$5,$6,$7) AS result',[workspace,bid,actor,expected,JSON.stringify(data),JSON.stringify(list),JSON.stringify(template)])).rows[0].result
}
async function launch(expected:string,actor=owner) { return (await db.query<{result:Result}>('SELECT launch_reviewed_broadcast_draft($1,$2,$3,$4) AS result',[ws,bid,actor,expected])).rows[0].result }
describe('atomic editable draft and explicit launch',()=>{
 it('saves on the same id, retains draft status, and queues only on explicit launch',async()=>{
  const saved=await save();expect(saved).toMatchObject({id:bid,status:'draft',total_recipients:1})
  expect((await db.query('SELECT params FROM broadcast_recipients')).rows).toEqual([{params:['Ana']}])
  expect(await launch(saved.updated_at)).toMatchObject({id:bid,status:'scheduled',total_recipients:1})
  await expect(launch(saved.updated_at)).rejects.toThrow('broadcast_draft_changed')
 })
 it('allows one concurrent save and refuses the stale snapshot',async()=>{
  const results=await Promise.allSettled([save(),save()]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
 })
 it('rejects another workspace and another non-admin author',async()=>{
  await expect(save(owner,other)).rejects.toThrow('broadcast_draft_invalid');await expect(save(member)).rejects.toThrow('broadcast_draft_invalid')
  await db.query("UPDATE workspace_members SET role='admin' WHERE user_id=$1",[member]);expect((await save(member)).status).toBe('draft')
 })
 it.each(['optout','foreign','excluded'])('rolls back the whole edit when a contact becomes %s',async kind=>{
  const saved=await save()
  if(kind==='optout')await db.exec('UPDATE contacts SET opted_out=true')
  if(kind==='foreign')await db.query('UPDATE contacts SET workspace_id=$1',[other])
  if(kind==='excluded')await db.query('INSERT INTO contact_tags VALUES($1,$2)',[contact,other])
  await expect(save(owner,ws,{...config,name:'Bad',audience_filter:{type:'all',excludeTagIds:[other]}},recipients,saved.updated_at)).rejects.toThrow('broadcast_draft_changed')
  expect((await db.query('SELECT name FROM broadcasts')).rows).toEqual([{name:'Edited'}]);expect((await db.query('SELECT * FROM broadcast_recipients')).rows).toHaveLength(1)
 })
 it('does not edit a campaign with a prior attempt or delivered row',async()=>{
  await db.query('INSERT INTO broadcast_delivery_receipts VALUES($1)',[bid]);await expect(save()).rejects.toThrow('broadcast_draft_changed')
  await db.exec('TRUNCATE broadcast_delivery_receipts');await db.query("INSERT INTO broadcast_recipients(broadcast_id,contact_id,status) VALUES($1,$2,'sent')",[bid,contact]);await expect(save()).rejects.toThrow('broadcast_draft_changed')
 })
 it('refuses a changed or rejected template and retains the reviewed draft',async()=>{
  const saved=await save();await db.exec("UPDATE message_templates SET body_text='Different'");await expect(launch(saved.updated_at)).rejects.toThrow('broadcast_draft_template')
  expect((await db.query('SELECT status FROM broadcasts')).rows).toEqual([{status:'draft'}])
 })
 it.each(['config','params','destination'])('refuses %s changes even if the caller knows the current timestamp',async kind=>{
  const saved=await save()
  if(kind==='config')await db.exec("UPDATE broadcasts SET create_conversations=false")
  if(kind==='params')await db.exec(`UPDATE broadcast_recipients SET params='["Different"]'`)
  if(kind==='destination')await db.query('UPDATE broadcast_recipients SET contact_id=$1',[other])
  await expect(launch(saved.updated_at)).rejects.toThrow('broadcast_draft_changed')
 })
 it('refuses empty launch and preserves future scheduling',async()=>{
  const saved=await save(owner,ws,{...config,scheduled_at:'2099-01-01T12:00:00Z'},[]);await expect(launch(saved.updated_at)).rejects.toThrow('broadcast_draft_changed')
  const filled=await save(owner,ws,{...config,scheduled_at:'2099-01-01T12:00:00Z'},recipients,saved.updated_at);await launch(filled.updated_at)
  expect((await db.query<{year:string}>("SELECT extract(year FROM scheduled_at)::text AS year FROM broadcasts")).rows[0].year).toBe('2099')
 })
 it.each(['billing','motor','connection','membership'])('keeps the draft paused when %s changes',async kind=>{
  const saved=await save()
  if(kind==='billing')await db.exec('UPDATE billing SET allowed=false')
  if(kind==='motor')await db.exec('UPDATE workspaces SET motor_apagado_at=now()')
  if(kind==='connection')await db.exec("UPDATE whatsapp_config SET status='disconnected'")
  if(kind==='membership')await db.exec('TRUNCATE workspace_members')
  await expect(launch(saved.updated_at)).rejects.toThrow(kind==='membership'?'broadcast_draft_invalid':'broadcast_draft_paused')
 })
 it('denies RPC execution to anonymous and authenticated clients',async()=>{
  const result=await db.query("SELECT has_function_privilege('anon','save_broadcast_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb)','execute') AS save,has_function_privilege('authenticated','launch_reviewed_broadcast_draft(uuid,uuid,uuid,timestamptz)','execute') AS launch")
  expect(result.rows[0]).toEqual({save:false,launch:false})
 })
 it('prevents a browser client from replacing the trusted review stamp',async()=>{
  await save();await db.exec('GRANT SELECT,UPDATE ON broadcasts TO authenticated;SET ROLE authenticated')
  try { await expect(db.exec(`UPDATE broadcasts SET draft_review='{"recipients":1}'`)).rejects.toThrow('broadcast_draft_invalid') }
  finally { await db.exec('RESET ROLE') }
 })
})
