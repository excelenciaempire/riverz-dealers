import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',contact='55555555-5555-4555-8555-555555555555',conv='66666666-6666-4666-8666-666666666666',connection='77777777-7777-4777-8777-777777777777',id='88888888-8888-4888-8888-888888888888',event='99999999-9999-4999-8999-999999999999';
const order='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',op='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',op2='cccccccc-cccc-4ccc-8ccc-cccccccccccc',event2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const guide={carrier:'Synthetic Carrier',tracking_number:'RETURN-42'};
let stamp:string,receivedAt:string;
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const record=(kind='guide',payload:unknown=guide,who=actor,eventId=event,expected=stamp)=>scalar('SELECT record_return_logistics($1,$2,$3,$4,$5,$6,$7)',[ws,who,id,eventId,kind,payload,expected]);
const read=(who=actor,cursor:number|null=null)=>scalar('SELECT read_return_logistics($1,$2,$3,$4)',[ws,who,id,cursor]);
const receipt=()=>({reference:'WAREHOUSE-42',quantity:2,condition:'accepted',received_at:receivedAt,note:'Reviewed manually'});
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE FUNCTION public.is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid())$$;
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid,channel text);
 CREATE TABLE orders(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,contact_id uuid,platform text DEFAULT 'shopify',shopify_order_id text DEFAULT '42');
 CREATE TABLE approval_requests(id uuid PRIMARY KEY,workspace_id uuid,kind text,status text,payload jsonb,decided_via text,decided_by uuid,notified_phone text);
 CREATE TABLE returns(id uuid PRIMARY KEY,order_id uuid,workspace_id uuid REFERENCES workspaces(id),contact_id uuid,conversation_id uuid,order_number text,kind text DEFAULT 'devolucion',reason text,status text DEFAULT 'aprobada',resolution text,customer_note text,photos jsonb DEFAULT '[]',platform text,decided_by uuid,decided_at timestamptz,created_at timestamptz DEFAULT now()-interval '1 day',updated_at timestamptz DEFAULT clock_timestamp());
 ALTER TABLE returns ENABLE ROW LEVEL SECURITY;CREATE POLICY returns_miembros ON returns FOR ALL TO authenticated USING(public.is_workspace_member(workspace_id));
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON returns TO anon,authenticated,service_role;
 CREATE FUNCTION touch_returns() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END$$;
 CREATE TRIGGER returns_touch BEFORE UPDATE ON returns FOR EACH ROW EXECUTE FUNCTION touch_returns();`);
 for(const name of ['310_inbox_order_actions','327_return_case_history','351_return_case_authority','352_return_logistics_evidence','353_receipt_linked_refund_proposals'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);TRUNCATE return_logistics_events,return_case_events,returns,contacts,conversations,channel_connections,workspace_members,workspaces CASCADE");
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,actor]);
 await db.query('INSERT INTO contacts VALUES($1,$2)',[contact,ws]);await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',NULL,NULL)",[conv,ws,contact]);
 await db.query("INSERT INTO returns(id,workspace_id,contact_id,conversation_id,resolution,customer_note) VALUES($1,$2,$3,$4,'KEEP NOTE','PRIVATE CUSTOMER')",[id,ws,contact,conv]);
 stamp=await scalar('SELECT updated_at::text FROM returns') as string;receivedAt=await scalar("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')") as string;
});

beforeEach(async()=>{await db.exec('TRUNCATE auth.users CASCADE');await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,owner]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin',NULL)",[ws,owner]);await db.query('INSERT INTO orders(id,workspace_id,contact_id) VALUES($1,$2,$3)',[order,ws,contact]);await db.query('UPDATE returns SET order_id=$1',[order]);stamp=await scalar('SELECT updated_at::text FROM returns') as string;await record('receipt',receipt());stamp=await scalar('SELECT updated_at::text FROM returns') as string;});
const action={type:'refund',amount:25,reason:'Received return reviewed by team'},preview={order_name:'#42',amount:'25.00',currency:'USD',financial_status:'paid',fulfillment_status:'fulfilled'};
const context=(who=actor)=>scalar('SELECT read_return_refund_context($1,$2,$3)',[ws,who,id]);
const prepare=(operation=op,who=actor,receiptId=event,request:unknown=action,value:unknown=preview)=>scalar('SELECT prepare_return_refund_preview($1,$2,$3,$4,$5,$6,$7,$8)',[ws,who,id,receiptId,operation,request,value,'a'.repeat(64)]);
const claim=(operation=op,who=owner)=>scalar('SELECT claim_inbox_order_action($1,$2,$3,$4)',[operation,ws,conv,who]);
describe('Receipt-linked refund proposals use the existing approval engine',()=>{
 it('keeps link tables and helpers private and search paths fixed',async()=>{
  expect(await scalar('SELECT return_refund_link_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM return_refund_links')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');}
  await db.exec('SET ROLE authenticated');await expect(context()).rejects.toThrow('permission denied');await expect(prepare()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('prepares only a receipt-bound immutable preview without claiming or refunding',async()=>{
  expect(await context()).toMatchObject({case_id:id,order_id:order,contact_id:contact,conversation_id:conv,receipt:{id:event,quantity:2,condition:'accepted'}});
  expect(await prepare()).toMatchObject({case_id:id,conversation_id:conv,operation:{id:op,status:'preview',action,preview:{...preview,return_receipt:{version:1,case_id:id,receipt_id:event,quantity:2,condition:'accepted'}}}});
  await prepare();expect(await scalar('SELECT count(*) FROM return_refund_links')).toBe(1);expect(await scalar('SELECT count(*) FROM inbox_order_actions')).toBe(1);expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
 });
 it('uses the existing current-administrator claim and financial lock',async()=>{
  await prepare();await expect(claim(op,actor)).rejects.toThrow('order_approval_forbidden');expect(await claim()).toMatchObject({claimed:true,operation:{status:'running',approved_by:owner}});
  expect(await claim()).toMatchObject({claimed:false});expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(1);
 });
 it('requires an actual human receipt even if legacy status was marked received',async()=>{
  await db.exec('DELETE FROM return_logistics_events');await expect(context()).rejects.toThrow('return_refund_receipt_required');await expect(prepare()).rejects.toThrow('return_refund_receipt_required');
 });
 it.each(['wrong_contact','wrong_business','wrong_conversation','missing_order','platform_case','closed_case','non_shopify'])('rejects inconsistent %s before preparing',async kind=>{
  if(kind==='wrong_contact')await db.query('UPDATE orders SET contact_id=$1',[other]);if(kind==='wrong_business')await db.query('UPDATE orders SET workspace_id=$1',[other]);
  if(kind==='wrong_conversation')await db.query('UPDATE returns SET conversation_id=$1',[other]);if(kind==='missing_order')await db.exec('UPDATE returns SET order_id=NULL');
  if(kind==='platform_case')await db.exec("UPDATE returns SET platform='mercadolibre'");if(kind==='closed_case')await db.exec("UPDATE returns SET status='resuelta'");if(kind==='non_shopify')await db.exec("UPDATE orders SET platform='manual'");
  await expect(context()).rejects.toThrow();await expect(prepare()).rejects.toThrow();expect(await scalar('SELECT count(*) FROM inbox_order_actions')).toBe(0);
 });
 it('requires current Orders, Inbox and Returns access both before preparation and at approval',async()=>{
  await db.exec(`UPDATE workspace_members SET allowed_sections='["/devoluciones","/bandeja"]' WHERE role='agent'`);await expect(context()).rejects.toThrow('return_not_found');await expect(prepare()).rejects.toThrow('return_not_found');
  await db.exec("UPDATE workspace_members SET allowed_sections=NULL");await prepare();await db.query('UPDATE workspaces SET owner_id=$1',[other]);
  await db.exec(`UPDATE workspace_members SET allowed_sections='["/bandeja","/pedidos"]' WHERE role='admin'`);await expect(claim()).rejects.toThrow('return_not_found');expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
 });
 it('rejects stale receipts at preparation and approval, while allowing a newly reviewed proposal',async()=>{
  await prepare();await record('receipt',{...receipt(),reference:'Corrected physical count',quantity:1},actor,event2);await expect(prepare(op2)).rejects.toThrow('return_refund_changed');await expect(claim()).rejects.toThrow('return_refund_changed');
  expect(await scalar('SELECT status FROM inbox_order_actions WHERE id=$1',[op])).toBe('preview');expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
  expect(await prepare(op2,actor,event2)).toMatchObject({operation:{id:op2,status:'preview'}});
 });
 it('does not duplicate active proposals for the same receipt, and preserves expired ones',async()=>{
  await prepare();await expect(prepare(op2)).rejects.toThrow('return_refund_pending');await db.query("UPDATE inbox_order_actions SET expires_at=now()-interval '1 minute' WHERE id=$1",[op]);
  expect(await prepare(op2)).toMatchObject({operation:{id:op2,status:'preview'}});expect(await scalar('SELECT count(*) FROM return_refund_links')).toBe(2);
 });
 it('rejects a collision with another ordinary preview without silently adopting it',async()=>{
  await scalar('SELECT save_inbox_order_preview($1,$2,$3,$4,$5,$6,$7,$8)',[op,ws,conv,order,actor,action,preview,'a'.repeat(64)]);await expect(prepare()).rejects.toThrow('return_refund_changed');expect(await scalar('SELECT count(*) FROM return_refund_links')).toBe(0);
 });
 it('blocks changed receiving evidence while a refund is running or uncertain',async()=>{
  await prepare();await claim();await expect(record('receipt',{...receipt(),quantity:1},actor,event2)).rejects.toThrow('return_refund_pending');
  await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'uncertain',{error:'Synthetic uncertain result'}]);await expect(record('receipt',{...receipt(),quantity:1},actor,event2)).rejects.toThrow('return_refund_pending');
  expect(await scalar("SELECT count(*) FROM return_logistics_events WHERE kind='receipt'")).toBe(1);expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(1);
 });
 it('retains the original financial engine outcome and permits later receipt corrections after completion',async()=>{
  await prepare();await claim();await scalar('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,'completed',{refund_id:'123',refunded_amount:'25.00',currency:'USD'}]);
  expect(await scalar('SELECT result FROM inbox_order_actions')).toEqual({refund_id:'123',refunded_amount:'25.00',currency:'USD'});expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
  await record('receipt',{...receipt(),note:'Reviewed after payment'},actor,event2);expect(await scalar('SELECT count(*) FROM return_refund_links')).toBe(1);
 });
 it('does not turn a deleted receipt/case into an unguarded ordinary refund',async()=>{
  await prepare();await db.query('DELETE FROM returns WHERE id=$1',[id]);expect(await scalar('SELECT count(*) FROM return_refund_links')).toBe(0);
  await expect(claim()).rejects.toThrow('return_refund_changed');expect(await scalar('SELECT count(*) FROM order_execution_locks')).toBe(0);
 });
 it('keeps legacy unlinked actions unaffected by the new guards',async()=>{
  await scalar('SELECT save_inbox_order_preview($1,$2,$3,$4,$5,$6,$7,$8)',[op,ws,conv,order,actor,action,preview,'a'.repeat(64)]);
  expect(await claim()).toMatchObject({claimed:true});await record('receipt',{...receipt(),note:'Unlinked case still editable'},actor,event2);expect(await read()).toMatchObject({status:'recibida'});
 });
 it('rejects changes to the reviewed linked order, action, fingerprint or receipt marker',async()=>{
  await prepare();for(const sql of ["UPDATE inbox_order_actions SET action=action||'{\"amount\":30}'", "UPDATE inbox_order_actions SET preview=preview-'return_receipt'", "UPDATE inbox_order_actions SET fingerprint=repeat('b',64)"])
   await expect(db.exec(sql)).rejects.toThrow('return_refund_changed');
 });
 it('checks current subscription before creating a linked proposal',async()=>{
  await db.exec('UPDATE workspaces SET writable=false');await expect(prepare()).rejects.toThrow('return_subscription_read_only');expect(await scalar('SELECT count(*) FROM return_refund_links')).toBe(0);
 });
 it.each(['gmail','outlook','zoho'])('rechecks the current private %s owner at preparation and approval',async channel=>{
  await db.query('INSERT INTO channel_connections VALUES($1,$2,$3,$4)',[connection,ws,actor,channel]);await db.query('UPDATE conversations SET channel=$1,connection_id=$2',[channel,connection]);await prepare();await expect(context(owner)).rejects.toThrow('return_not_found');await expect(claim()).rejects.toThrow('order_approval_forbidden');
  await db.query('UPDATE channel_connections SET created_by=$1',[owner]);await expect(context()).rejects.toThrow('return_not_found');
 });
 it('validates null context and refund-only contracts without trusting caller receipt metadata',async()=>{
  await expect(scalar('SELECT read_return_refund_context(NULL,NULL,NULL)')).rejects.toThrow('invalid_return_refund');
  for(const request of [{...action,type:'credit'},{...action,amount:0},{...action,reason:''},{...action,credential:'SECRET'}])await expect(prepare(op,actor,event,request)).rejects.toThrow('invalid_return_refund');
  for(const value of [{...preview,currency:null},{...preview,currency:undefined},{...preview,amount:'0.00'}])await expect(prepare(op,actor,event,action,value)).rejects.toThrow('invalid_return_refund');
  expect(await prepare(op,actor,event,action,{...preview,return_receipt:{receipt_id:other}})).toMatchObject({operation:{preview:{return_receipt:{receipt_id:event}}}});
 });
});
