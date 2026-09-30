import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite()
const ws='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',member='99999999-9999-4999-8999-999999999999'
const bid='44444444-4444-4444-8444-444444444444',contact='55555555-5555-4555-8555-555555555555',rid='66666666-6666-4666-8666-666666666666',id='77777777-7777-4777-8777-777777777777',tpl='88888888-8888-4888-8888-888888888888',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const source={ template_name:'hello',template_language:'es',voice_note:null,variable_mapping:null,audience_filter:{excludeTagIds:[]},contact_id:contact,params:['Ana'],phone:'573003364305',template:{id:tpl,category:'UTILITY',status:'APPROVED',body_text:'Hola {{1}}.'} }
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE workspaces(id uuid PRIMARY KEY,suspended_at timestamptz,motor_apagado_at timestamptz);CREATE TABLE workspace_members(workspace_id uuid,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text);
 CREATE TABLE broadcasts(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id),status text,template_name text,template_language text,voice_note jsonb,variable_mapping jsonb,audience_filter jsonb,scheduled_at timestamptz);
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,phone text,opted_out boolean);CREATE TABLE contact_tags(contact_id uuid,tag_id uuid);
 CREATE TABLE broadcast_recipients(id uuid PRIMARY KEY,broadcast_id uuid REFERENCES broadcasts(id) ON DELETE CASCADE,contact_id uuid,status text,params jsonb,whatsapp_message_id text UNIQUE,sent_at timestamptz,error_message text);
 CREATE TABLE message_templates(id uuid PRIMARY KEY,workspace_id uuid,name text,language text,category text,status text,body_text text,user_id uuid,waba_id text);CREATE TABLE whatsapp_config(workspace_id uuid,waba_id text,status text);
 CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;`)
 const sql=readFileSync('supabase/migrations/322_broadcast_delivery_receipts.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces,auth.users,contacts,contact_tags,message_templates,whatsapp_config CASCADE;UPDATE billing SET allowed=true')
 await db.query('INSERT INTO workspaces(id) VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2),($3)',[owner,admin,member])
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'admin'),($1,$4,'agent')",[ws,owner,admin,member])
 await db.query("INSERT INTO broadcasts VALUES($1,$2,$3,'sending','hello','es',NULL,NULL,$4,NULL)",[bid,ws,owner,JSON.stringify(source.audience_filter)])
 await db.query('INSERT INTO contacts VALUES($1,$2,$3,false)',[contact,ws,source.phone])
 await db.query("INSERT INTO broadcast_recipients(id,broadcast_id,contact_id,status,params) VALUES($1,$2,$3,'pending',$4)",[rid,bid,contact,JSON.stringify(source.params)])
 await db.query("INSERT INTO message_templates VALUES($1,$2,'hello','es','UTILITY','APPROVED','Hola {{1}}.',$3,'waba')",[tpl,ws,owner])
 await db.query("INSERT INTO whatsapp_config VALUES($1,'waba','connected')",[ws])
})
const claim=(receipt=id,recipient=rid,actor:string|null=owner,input:unknown=source,workspace=ws,hash='a'.repeat(64),payload='b'.repeat(64))=>db.query<{result:{claimed:boolean;state:string;receipt_id?:string;message_id?:string}}>('SELECT claim_broadcast_delivery($1,$2,$3,$4,$5,$6,$7,$8) AS result',[receipt,workspace,bid,recipient,actor,hash,payload,JSON.stringify(input)])
const finish=(state='accepted',message:string|null='wamid.confirmed',receipt=id)=>db.query('SELECT finish_broadcast_delivery($1,$2,$3,$4)',[receipt,state,message,state==='accepted'?null:'broadcast_delivery_uncertain'])
describe('durable campaign reservation and outcome transaction',()=>{
 it('finalizes from every stored recipient and preserves externally changed state',async()=>{
  const finalize=()=>db.query<{result:{status:string;changed:boolean}}>('SELECT finalize_broadcast_delivery_progress($1,$2,$3,60) AS result',[ws,bid,owner])
  expect((await finalize()).rows[0].result).toMatchObject({status:'scheduled',changed:true});await db.exec("UPDATE broadcasts SET status='sending'");await claim();await finish();await db.query("INSERT INTO broadcast_recipients(id,broadcast_id,contact_id,status) VALUES($1,$2,$3,'failed')",[second,bid,contact]);expect((await finalize()).rows[0].result.status).toBe('sent');await db.exec("UPDATE broadcasts SET status='draft'");expect((await finalize()).rows[0].result).toEqual({status:'draft',changed:false})
 })
 it('allows exactly one reservation under concurrent claims and copies proof atomically',async()=>{
  const results=await Promise.all([claim(),claim(second)]);expect(results.map(x=>x.rows[0].result.claimed)).toEqual([true,false]);await finish();expect((await claim(second)).rows[0].result).toMatchObject({claimed:false,state:'accepted',message_id:'wamid.confirmed'})
  expect((await db.query('SELECT status,whatsapp_message_id FROM broadcast_recipients')).rows).toEqual([{status:'sent',whatsapp_message_id:'wamid.confirmed'}])
 })
 it('keeps an interrupted reservation uncertain after ten minutes without granting another send',async()=>{
  await db.query("INSERT INTO broadcast_delivery_receipts(id,workspace_id,broadcast_id,recipient_key,recipient_id,destination_hash,payload_hash,created_at) VALUES($1,$2,$3,$4,$4,$5,$6,'2000-01-01')",[id,ws,bid,rid,'a'.repeat(64),'b'.repeat(64)])
  expect((await claim(second)).rows[0].result).toMatchObject({claimed:false,state:'uncertain'});expect((await db.query<{status:string;error_message:string}>('SELECT status,error_message FROM broadcast_recipients')).rows).toEqual([{status:'failed',error_message:'broadcast_delivery_uncertain'}]);expect((await claim(second)).rows[0].result.claimed).toBe(false)
 })
 it('accepts late concrete proof and never downgrades delivery/read status or changes its message id',async()=>{
  await claim();await finish('uncertain',null);await finish();await db.exec("UPDATE broadcast_recipients SET status='read'");await finish();expect((await db.query<{status:string}>('SELECT status FROM broadcast_recipients')).rows[0].status).toBe('read');await expect(finish('accepted','different')).rejects.toThrow('broadcast_receipt_changed')
 })
 it('does not release a definite rejection or overwrite an uncertain outcome with another attempt',async()=>{
  await claim();await finish('rejected',null);expect((await claim(second)).rows[0].result.state).toBe('rejected');await expect(finish()).rejects.toThrow('broadcast_receipt_changed');expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM broadcast_delivery_receipts')).rows[0].n).toBe(1)
 })
 it('protects scope, current membership, owner/admin and unchanged source contents',async()=>{
  await expect(claim(id,rid,owner,source,other)).rejects.toThrow('invalid_broadcast_receipt');await expect(claim(id,rid,member)).rejects.toThrow('invalid_broadcast_receipt');await db.query('DELETE FROM workspace_members WHERE user_id=$1',[owner]);await expect(claim()).rejects.toThrow('invalid_broadcast_receipt');expect((await claim(id,rid,admin,{...source,phone:'different'})).rows[0].result.state).toBe('changed');expect((await db.query('SELECT * FROM broadcast_delivery_receipts')).rows).toHaveLength(0)
 })
 it('blocks current opt-outs and exclusion tags inside the reservation transaction',async()=>{
  await db.exec('UPDATE contacts SET opted_out=true');expect((await claim()).rows[0].result.state).toBe('opted_out');await db.exec("UPDATE contacts SET opted_out=false;UPDATE broadcast_recipients SET status='pending'")
  await db.query('INSERT INTO contact_tags VALUES($1,$2)',[contact,second]);await db.query('UPDATE broadcasts SET audience_filter=$1',[JSON.stringify({excludeTagIds:[second]})]);expect((await claim()).rows[0].result.state).toBe('excluded');expect((await db.query('SELECT * FROM broadcast_delivery_receipts')).rows).toHaveLength(0)
 })
 it('requires exact workspace/language and approved unambiguous templates, except for voice notes',async()=>{
  await db.exec("UPDATE message_templates SET status='PAUSED'");expect((await claim()).rows[0].result.state).toBe('template_unavailable');await db.query("UPDATE broadcasts SET voice_note=$1",[JSON.stringify({text:'audio'})]);expect((await claim(id,rid,owner,{...source,voice_note:{text:'audio'},template:null})).rows[0].result.claimed).toBe(true)
 })
 it('preserves creator-owned cache copies and rejects templates from another connected account',async()=>{
  await db.query("INSERT INTO message_templates VALUES($1,$2,'hello','es','UTILITY','APPROVED','Hola {{1}}.',$3,'waba')",[second,ws,admin]);expect((await claim()).rows[0].result.claimed).toBe(true)
  await db.exec('DELETE FROM broadcast_delivery_receipts');await db.exec("UPDATE message_templates SET waba_id='other' WHERE user_id='"+owner+"'");expect((await claim()).rows[0].result.state).toBe('template_unavailable')
  await db.exec("UPDATE message_templates SET waba_id=NULL WHERE user_id='"+owner+"'");expect((await claim()).rows[0].result.claimed).toBe(true)
 })
 it('uses shared connected copies only when all describe the same approved payload',async()=>{
  await db.query('UPDATE message_templates SET user_id=$1',[admin]);expect((await claim()).rows[0].result.claimed).toBe(true)
  await db.exec('DELETE FROM broadcast_delivery_receipts');await db.query("INSERT INTO message_templates VALUES($1,$2,'hello','es','UTILITY','APPROVED','Different body',$3,'waba')",[second,ws,member]);expect((await claim()).rows[0].result.state).toBe('template_unavailable')
 })
 it('pauses new attempts on billing or motor restrictions while preserving accepted proof',async()=>{
  await db.exec('UPDATE billing SET allowed=false');expect((await claim()).rows[0].result.state).toBe('paused');await db.exec('UPDATE billing SET allowed=true;UPDATE workspaces SET motor_apagado_at=now()');expect((await claim()).rows[0].result.state).toBe('paused');await db.exec('UPDATE workspaces SET motor_apagado_at=NULL');await claim();await finish();await db.exec('UPDATE billing SET allowed=false');expect((await claim(second)).rows[0].result.state).toBe('accepted')
 })
 it('deduplicates destinations and retains that protection after deleting a recipient',async()=>{
  await claim();await db.query('DELETE FROM broadcast_recipients WHERE id=$1',[rid]);expect((await db.query('SELECT recipient_id,recipient_key FROM broadcast_delivery_receipts')).rows).toEqual([{recipient_id:null,recipient_key:rid}]);await db.query("INSERT INTO broadcast_recipients(id,broadcast_id,contact_id,status,params) VALUES($1,$2,$3,'pending',$4)",[second,bid,contact,JSON.stringify(source.params)]);expect((await claim(second,second)).rows[0].result.state).toBe('duplicate')
 })
 it('retains immutable sources and removes identity without losing the receipt',async()=>{
  await claim(id,rid,admin);await expect(db.exec("UPDATE broadcast_delivery_receipts SET payload_hash=repeat('c',64)")).rejects.toThrow('invalid_broadcast_receipt');await db.query('DELETE FROM auth.users WHERE id=$1',[admin]);expect((await db.query<{actor_id:string|null}>('SELECT actor_id FROM broadcast_delivery_receipts')).rows[0].actor_id).toBeNull();await db.query('DELETE FROM broadcasts WHERE id=$1',[bid]);expect((await db.query('SELECT * FROM broadcast_delivery_receipts')).rows).toHaveLength(0)
 })
 it('denies client reads, writes and RPC execution and rejects missing/invalid proof',async()=>{
  expect((await db.query("SELECT has_table_privilege('authenticated','broadcast_delivery_receipts','select') AS can_read,has_table_privilege('authenticated','broadcast_delivery_receipts','update') AS can_write,has_function_privilege('anon','claim_broadcast_delivery(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','execute') AS can_claim")).rows[0]).toEqual({can_read:false,can_write:false,can_claim:false});await expect(claim(id,rid,owner,source,ws,'bad')).rejects.toThrow('invalid_broadcast_receipt');await claim();await expect(finish('accepted','')).rejects.toThrow('invalid_broadcast_receipt');await expect(finish('uncertain','unexpected')).rejects.toThrow('invalid_broadcast_receipt')
 })
})
