import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const ws='11111111-1111-4111-8111-111111111111', actor='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333';
const contact='44444444-4444-4444-8444-444444444444', connection='55555555-5555-4555-8555-555555555555', conv='66666666-6666-4666-8666-666666666666';
const order='77777777-7777-4777-8777-777777777777', req='88888888-8888-4888-8888-888888888888', msg='99999999-9999-4999-8999-999999999999';
const op='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', req2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', op2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const address={address1:'42 Synthetic Street',address2:'',city:'Synthetic City',province:'',zip:'',countryCode:'US'};
const preview={order_name:'#42',amount:null,currency:'USD',financial_status:'pending',fulfillment_status:null,shipping_change:{before:{...address,address1:'OLD'},after:address,validation:'disabled'}};
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const reserve=(id=req,who='signed-visitor',body:unknown=address,target=order)=>scalar('SELECT reserve_webchat_address_request($1,$2,$3,$4,$5,$6,$7)',[ws,connection,who,id,target,body,'CUSTOMER REQUEST']);
const submit=(id=req,who='signed-visitor')=>scalar('SELECT submit_webchat_address_request($1,$2,$3,$4)',[ws,connection,who,id]);
const receipt=(id=req,who='signed-visitor')=>scalar('SELECT read_webchat_address_receipt($1,$2,$3,$4)',[ws,connection,who,id]);
const prepare=(id=op,request=req,who=actor,value:unknown=preview,fp:string|null='a'.repeat(64))=>scalar('SELECT prepare_webchat_address_preview($1,$2,$3,$4,$5,$6,$7)',[ws,who,conv,request,id,value,fp]);
const claim=(id=op)=>scalar('SELECT claim_inbox_order_action($1,$2,$3,$4)',[id,ws,conv,actor]);
const ingress=async(id=req,message=msg)=>db.query("INSERT INTO messages(id,conversation_id,message_id,channel,sender_type,content_text) VALUES($1,$2,$3,'webchat','customer','CUSTOMER REQUEST')",[message,conv,'wc_'+id]);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE FUNCTION public.is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,channel text,external_id text);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,channel text,created_by uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,connection_id uuid,channel text,deleted_at timestamptz);
 CREATE TABLE orders(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,contact_id uuid,platform text,order_number text,shopify_order_id text);
 CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,message_id text,channel text,sender_type text,content_text text,deleted_at timestamptz);
 CREATE TABLE approval_requests(id uuid PRIMARY KEY,workspace_id uuid,kind text,status text,payload jsonb,decided_via text,decided_by uuid,notified_phone text);
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 for(const name of ['310_inbox_order_actions','355_webchat_order_address_requests'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE workspaces,auth.users,contacts,conversations,channel_connections,messages,workspace_members CASCADE');
 await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,other]);await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,actor,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)",[ws,actor]);
 await db.query("INSERT INTO contacts VALUES($1,$2,'webchat','signed-visitor')",[contact,ws]);await db.query("INSERT INTO channel_connections VALUES($1,$2,'webchat',$3)",[connection,ws,actor]);
 await db.query("INSERT INTO conversations VALUES($1,$2,$3,$4,'webchat',NULL)",[conv,ws,contact,connection]);
 await db.query("INSERT INTO orders VALUES($1,$2,$3,'shopify','#42','42')",[order,ws,contact]);
});
describe('Signed customer requests use the real message and human order engine',()=>{
 it('keeps both tables and RPCs private with fixed search paths',async()=>{
  expect(await scalar('SELECT webchat_address_request_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM webchat_order_address_requests')).rejects.toThrow('permission denied');await expect(db.exec('SELECT * FROM webchat_order_address_links')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
 });
 it('separates reservation, real ingress, preparation and verified completion',async()=>{
  expect(await reserve()).toMatchObject({status:'not_submitted',confirmed_at:null});await expect(submit()).rejects.toThrow('address_request_source_missing');
  await ingress();expect(await submit()).toMatchObject({status:'waiting_review'});expect(await prepare()).toEqual({operation_id:op,order_id:order,request_id:req});
  expect(await receipt()).toMatchObject({status:'prepared'});expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
  await claim();expect(await receipt()).toMatchObject({status:'processing'});
  await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'completed',{shipping_after:address,shipping_before:preview.shipping_change.before,currency:'USD'}]);
  expect(await receipt()).toMatchObject({status:'confirmed',superseded:false});expect((await receipt() as {confirmed_at:string}).confirmed_at).toBeTruthy();
 });
 it.each(['wrong_visitor','wrong_order_owner','wrong_workspace','wrong_connection','deleted_case'])('rejects %s without broadening identity',async kind=>{
  await reserve();await ingress();await submit();
  if(kind==='wrong_order_owner')await db.query('UPDATE orders SET contact_id=$1',[other]);if(kind==='wrong_workspace')await db.query('UPDATE contacts SET workspace_id=$1',[other]);
  if(kind==='wrong_connection')await db.query('UPDATE conversations SET connection_id=$1',[other]);if(kind==='deleted_case')await db.exec('UPDATE conversations SET deleted_at=now()');
  await expect(receipt(req,kind==='wrong_visitor'?'guessed-email': 'signed-visitor')).rejects.toThrow('address_request_not_found');
 });
 it.each(['sender','body','channel','deleted','contact','connection'])('requires the actual customer source: %s',async kind=>{
  await reserve();await ingress();if(kind==='sender')await db.exec("UPDATE messages SET sender_type='bot'");if(kind==='body')await db.exec("UPDATE messages SET content_text='OTHER'");
  if(kind==='channel')await db.exec("UPDATE messages SET channel='whatsapp'");if(kind==='deleted')await db.exec('UPDATE messages SET deleted_at=now()');
  if(kind==='contact')await db.query('UPDATE conversations SET contact_id=$1',[other]);if(kind==='connection')await db.query('UPDATE conversations SET connection_id=$1',[other]);
  await expect(submit()).rejects.toThrow('address_request_source_missing');expect(await scalar('SELECT count(*) FROM inbox_order_actions')).toBe(0);
 });
 it('recovers exact retries without new message, request or operation',async()=>{
  await reserve();await reserve();await ingress();await submit();await submit();await prepare();await prepare();
  expect(await prepare(op,req,actor,null,null)).toEqual({operation_id:op,order_id:order,request_id:req});
  await db.exec('UPDATE workspaces SET writable=false');expect(await prepare(op,req,actor,null,null)).toMatchObject({operation_id:op});
  expect(await reserve()).toMatchObject({status:'prepared'});expect(await scalar('SELECT count(*) FROM webchat_order_address_requests')).toBe(1);expect(await scalar('SELECT count(*) FROM inbox_order_actions')).toBe(1);
 });
 it('rejects nonce changes and an unrelated ordinary preview',async()=>{
  await reserve();await expect(reserve(req,'signed-visitor',{...address,city:'OTHER'})).rejects.toThrow('address_request_changed');
  await ingress();await submit();await scalar('SELECT save_inbox_order_preview($1,$2,$3,$4,$5,$6,$7,$8)',[op,ws,conv,order,actor,{type:'address',address,reason:'webchat_address_request'},preview,'a'.repeat(64)]);
  await expect(prepare()).rejects.toThrow('address_request_changed');
 });
 it('supersedes pending requests and rejects their old approvals',async()=>{
  await reserve();await ingress();await submit();await prepare();await reserve(req2);await ingress(req2,op2);await submit(req2);
  expect(await receipt()).toMatchObject({status:'superseded'});await expect(claim()).rejects.toThrow('address_request_changed');expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
 });
 it('does not let delayed submission of an older reservation replace a newer request',async()=>{
  await reserve();await reserve(req2);await ingress(req2,op2);await submit(req2);await ingress();await expect(submit()).rejects.toThrow('address_request_changed');
  expect(await receipt(req2)).toMatchObject({status:'waiting_review',superseded:false});
 });
 it('blocks replacement during running or uncertain operations and retains uncertain locks',async()=>{
  await reserve();await ingress();await submit();await prepare();await claim();await expect(reserve(req2)).rejects.toThrow('address_request_pending');
  await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'uncertain',{error:'Synthetic timeout'}]);
  expect(await receipt()).toMatchObject({status:'needs_review',confirmed_at:null});await expect(reserve(req2)).rejects.toThrow('address_request_pending');
 });
 it('does not treat a completed HTTP-only or mismatched result as a verified address change',async()=>{
  await reserve();await ingress();await submit();await prepare();await claim();
  await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'completed',{ok:true,status:200,shipping_after:{...address,city:'DIFFERENT'}}]);
  expect(await receipt()).toMatchObject({status:'needs_review',confirmed_at:null});
 });
 it('matches the shared shipping verifier for whitespace and letter-case differences',async()=>{
  await reserve();await ingress();await submit();await prepare();await claim();
  await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'completed',{shipping_after:{...address,address1:'  42 SYNTHETIC   STREET  ',city:'SYNTHETIC CITY'}}]);
  expect(await receipt()).toMatchObject({status:'confirmed'});
 });
 it('never confirms an incomplete address result with only one matching field',async()=>{
  await reserve();await ingress();await submit();await prepare();await claim();
  await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'completed',{shipping_after:{city:address.city}}]);
  expect(await receipt()).toMatchObject({status:'needs_review',confirmed_at:null});
 });
 it('requires current section permissions and rechecks them at approval',async()=>{
  await reserve();await ingress();await submit();await prepare();await db.query('UPDATE workspaces SET owner_id=$1',[other]);await db.exec(`UPDATE workspace_members SET allowed_sections='["/bandeja"]'`);
  await expect(prepare(op2)).rejects.toThrow('address_request_not_found');await expect(claim()).rejects.toThrow('address_request_changed');
 });
 it('invalidates expired requests, changed sources and missing origin links',async()=>{
  await reserve();await ingress();await submit();await prepare();await db.exec('UPDATE webchat_order_address_requests SET expires_at=now()-interval \'1 minute\'');
  await expect(claim()).rejects.toThrow('address_request_changed');await db.exec('UPDATE webchat_order_address_requests SET expires_at=now()+interval \'1 hour\'');
  await db.exec("UPDATE messages SET content_text='CHANGED'");await expect(claim()).rejects.toThrow('address_request_changed');
  await db.query('DELETE FROM messages WHERE id=$1',[msg]);await expect(claim()).rejects.toThrow('address_request_changed');
 });
 it('cannot tamper with the linked action, fingerprint, target or marker',async()=>{
  await reserve();await ingress();await submit();await prepare();
  for(const sql of ["UPDATE inbox_order_actions SET preview=preview-'customer_request'","UPDATE inbox_order_actions SET fingerprint=repeat('b',64)","UPDATE inbox_order_actions SET action=action||'{\"reason\":\"OTHER\"}'"]){await expect(db.exec(sql)).rejects.toThrow('address_request_changed');}
 });
 it('keeps an already confirmed result historical after a later request',async()=>{
  await reserve();await ingress();await submit();await prepare();await claim();await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'completed',{shipping_after:address}]);
  await reserve(req2);await ingress(req2,op2);await submit(req2);expect(await receipt()).toMatchObject({status:'confirmed',superseded:true});
 });
 it('normal unlinked order operations retain their existing behavior',async()=>{
  await scalar('SELECT save_inbox_order_preview($1,$2,$3,$4,$5,$6,$7,$8)',[op,ws,conv,order,actor,{type:'cancel',reason:'Existing operation'},preview,'a'.repeat(64)]);expect(await claim()).toMatchObject({claimed:true});
 });
});
