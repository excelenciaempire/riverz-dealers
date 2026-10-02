import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {returnLogisticsPage} from './logistics-contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',contact='55555555-5555-4555-8555-555555555555',conv='66666666-6666-4666-8666-666666666666',connection='77777777-7777-4777-8777-777777777777',id='88888888-8888-4888-8888-888888888888',event='99999999-9999-4999-8999-999999999999';
const guide={carrier:'Synthetic Carrier',tracking_number:'RETURN-42'};
let stamp:string,receivedAt:string;
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const record=(kind='guide',payload:unknown=guide,who=actor,eventId=event,expected=stamp)=>scalar('SELECT record_return_logistics($1,$2,$3,$4,$5,$6,$7)',[ws,who,id,eventId,kind,payload,expected]);
const read=(who=actor,cursor:number|null=null)=>scalar('SELECT read_return_logistics($1,$2,$3,$4)',[ws,who,id,cursor]);
const receipt=()=>({reference:'WAREHOUSE-42',quantity:2,condition:'accepted',received_at:receivedAt,note:'Reviewed manually'});
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE FUNCTION public.is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid())$$;
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid);
 CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,channel text,connection_id uuid,deleted_at timestamptz);
 CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid,created_by uuid,channel text);
 CREATE TABLE returns(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),contact_id uuid,conversation_id uuid,order_number text,kind text DEFAULT 'devolucion',reason text,status text DEFAULT 'aprobada',resolution text,customer_note text,photos jsonb DEFAULT '[]',platform text,decided_by uuid,decided_at timestamptz,created_at timestamptz DEFAULT now()-interval '1 day',updated_at timestamptz DEFAULT clock_timestamp());
 ALTER TABLE returns ENABLE ROW LEVEL SECURITY;CREATE POLICY returns_miembros ON returns FOR ALL TO authenticated USING(public.is_workspace_member(workspace_id));
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON returns TO anon,authenticated,service_role;
 CREATE FUNCTION touch_returns() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END$$;
 CREATE TRIGGER returns_touch BEFORE UPDATE ON returns FOR EACH ROW EXECUTE FUNCTION touch_returns();`);
 for(const name of ['327_return_case_history','351_return_case_authority','352_return_logistics_evidence'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);TRUNCATE return_logistics_events,return_case_events,returns,contacts,conversations,channel_connections,workspace_members,workspaces CASCADE");
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,actor]);
 await db.query('INSERT INTO contacts VALUES($1,$2)',[contact,ws]);await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',NULL,NULL)",[conv,ws,contact]);
 await db.query("INSERT INTO returns(id,workspace_id,contact_id,conversation_id,resolution,customer_note) VALUES($1,$2,$3,$4,'KEEP NOTE','PRIVATE CUSTOMER')",[id,ws,contact,conv]);
 stamp=await scalar('SELECT updated_at::text FROM returns') as string;receivedAt=await scalar("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')") as string;
});
describe('Private manual return guide and receipt evidence',()=>{
 it('enforces private table, sequence, functions and fixed search paths',async()=>{
  expect(await scalar('SELECT return_logistics_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`SET ROLE ${role}`);await expect(db.exec('SELECT * FROM return_logistics_events')).rejects.toThrow('permission denied');
   await expect(db.exec("INSERT INTO return_logistics_events(id,workspace_id,case_id,actor_id,kind,payload) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'guide','{}')")).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE authenticated');await expect(read()).rejects.toThrow('permission denied');await expect(record()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('records an immutable current-actor guide and keeps the return note and state',async()=>{
  const result=await record();expect(result).toMatchObject({event_id:event,unchanged:false,status:'aprobada'});expect(await scalar('SELECT resolution FROM returns')).toBe('KEEP NOTE');
  expect(await scalar('SELECT actor_id FROM return_logistics_events')).toBe(actor);expect(await scalar('SELECT updated_at::text FROM returns')).not.toBe(stamp);
  expect(returnLogisticsPage.parse(await read()).events[0]).toMatchObject({kind:'guide',payload:guide,actor_id:actor});
 });
 it('atomically records a human receipt, status and case audit without a payment',async()=>{
  expect(await record('receipt',receipt(),owner)).toMatchObject({status:'recibida',unchanged:false});expect(await scalar('SELECT decided_by FROM returns')).toBe(owner);
  expect(await scalar("SELECT actor_id FROM return_case_events WHERE event_type='state_changed'")).toBe(owner);expect(await scalar('SELECT resolution FROM returns')).toBe('KEEP NOTE');
  const page=returnLogisticsPage.parse(await read());expect(page.status).toBe('recibida');expect(page.events[0]).toMatchObject({kind:'receipt',payload:receipt()});expect(JSON.stringify(page)).not.toContain('PRIVATE CUSTOMER');
 });
 it('makes identical retries immutable even after the concurrency token and subscription change',async()=>{
  await record();const count=await scalar('SELECT count(*) FROM return_case_events');await db.exec('UPDATE workspaces SET writable=false');
  expect(await record()).toMatchObject({unchanged:true});expect(await scalar('SELECT count(*) FROM return_logistics_events')).toBe(1);expect(await scalar('SELECT count(*) FROM return_case_events')).toBe(count);
 });
 it('rejects identifier reuse with a different actor, payload, kind or business',async()=>{
  await record();await expect(record('guide',{...guide,carrier:'Different'})).rejects.toThrow('return_logistics_conflict');await expect(record('guide',guide,owner)).rejects.toThrow('return_logistics_conflict');
  await expect(record('receipt',receipt())).rejects.toThrow('return_logistics_conflict');
  await db.query('UPDATE return_logistics_events SET workspace_id=$1',[other]);await expect(record()).rejects.toThrow('return_logistics_conflict');
 });
 it.each(['member_removed','wrong_section','deleted_workspace','wrong_role'])('denies current %s on writes and reads',async kind=>{
  if(kind==='member_removed')await db.exec('DELETE FROM workspace_members');if(kind==='wrong_section')await db.exec(`UPDATE workspace_members SET allowed_sections='["/bandeja"]'`);
  if(kind==='deleted_workspace')await db.exec('UPDATE workspaces SET deleted_at=now()');if(kind==='wrong_role')await db.exec("UPDATE workspace_members SET role='unknown'");
  await expect(record()).rejects.toThrow();await expect(read()).rejects.toThrow('return_not_found');expect(await scalar('SELECT count(*) FROM return_logistics_events')).toBe(0);
 });
 it.each(['gmail','outlook','zoho'])('protects the current private %s owner',async channel=>{
  await db.query('INSERT INTO channel_connections VALUES($1,$2,$3,$4)',[connection,ws,actor,channel]);await db.query('UPDATE conversations SET channel=$1,connection_id=$2',[channel,connection]);
  await expect(record('guide',guide,owner)).rejects.toThrow('return_not_found');await expect(read(owner)).rejects.toThrow('return_not_found');await record();
  await db.query('UPDATE channel_connections SET created_by=$1',[owner]);await expect(record()).rejects.toThrow('return_not_found');await expect(read()).rejects.toThrow('return_not_found');
 });
 it.each(['foreign_contact','mismatched_contact','deleted_case','no_inbox'])('rejects inconsistent or inaccessible %s cases',async kind=>{
  if(kind==='foreign_contact')await db.query('UPDATE contacts SET workspace_id=$1',[other]);if(kind==='mismatched_contact')await db.query('UPDATE conversations SET contact_id=$1',[other]);
  if(kind==='deleted_case')await db.exec('UPDATE conversations SET deleted_at=now()');if(kind==='no_inbox')await db.exec(`UPDATE workspace_members SET allowed_sections='["/devoluciones"]'`);
  await expect(record()).rejects.toThrow('return_not_found');await expect(read()).rejects.toThrow('return_not_found');
 });
 it('keeps platform-managed cases read-only and requires an approved live local case',async()=>{
  await db.exec("UPDATE returns SET platform='mercadolibre'");expect(returnLogisticsPage.parse(await read()).platform).toBe('mercadolibre');await expect(record()).rejects.toThrow('return_platform_managed');
  for(const status of ['abierta','rechazada','resuelta']){await db.query('UPDATE returns SET platform=NULL,status=$1',[status]);stamp=await scalar('SELECT updated_at::text FROM returns') as string;await expect(record()).rejects.toThrow('invalid_return_transition');}
 });
 it('checks exact microseconds and current writable billing before a new record',async()=>{
  await expect(record('guide',guide,actor,event,stamp.replace(/\.\d+/,'\.000000'))).rejects.toThrow('return_decision_changed');await db.exec('UPDATE workspaces SET writable=false');await expect(record()).rejects.toThrow('return_subscription_read_only');
 });
 it('rejects malformed guide/receipt values, unknown keys and future/historically inconsistent dates',async()=>{
  for(const payload of [{},null,{...guide,carrier:''},{...guide,carrier:' padded '},{...guide,token:'PRIVATE'}])await expect(record('guide',payload)).rejects.toThrow('invalid_return_logistics');
  for(const payload of [{...receipt(),quantity:0},{...receipt(),quantity:1.2},{...receipt(),quantity:10001},{...receipt(),quantity:'2'},{...receipt(),condition:'provider_confirmed'},
   {...receipt(),received_at:'tomorrow'},{...receipt(),received_at:'9999-01-01T00:00:00Z'},{...receipt(),received_at:'2001-01-01T00:00:00Z'},{...receipt(),reference:' '},{...receipt(),secret:'PRIVATE'}])await expect(record('receipt',payload)).rejects.toThrow('invalid_return_logistics');
  expect(await scalar('SELECT count(*) FROM return_logistics_events')).toBe(0);
 });
 it('rolls back the receipt if the historical audit fails',async()=>{
  await db.exec(`CREATE FUNCTION fail_receipt_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic audit failure';END$$;
   CREATE TRIGGER fail_receipt_audit BEFORE INSERT ON return_case_events FOR EACH ROW EXECUTE FUNCTION fail_receipt_audit();`);
  try{await expect(record('receipt',receipt())).rejects.toThrow('synthetic audit failure');expect(await scalar('SELECT count(*) FROM return_logistics_events')).toBe(0);expect(await scalar('SELECT status FROM returns')).toBe('aprobada');}
  finally{await db.exec('DROP TRIGGER fail_receipt_audit ON return_case_events;DROP FUNCTION fail_receipt_audit()');}
 });
 it('paginates tied timestamps without losing records and caps each case',async()=>{
  await db.query("INSERT INTO return_logistics_events(id,workspace_id,case_id,actor_id,kind,payload,recorded_at) SELECT gen_random_uuid(),$1,$2,$3,'guide',$4,'2026-01-01' FROM generate_series(1,43)",[ws,id,actor,guide]);
  const ids:string[]=[];let cursor:number|null=null;do{const page=returnLogisticsPage.parse(await read(actor,cursor));ids.push(...page.events.map(row=>row.id));cursor=page.next_cursor?JSON.parse(page.next_cursor).event_sequence:null;}while(cursor);
  expect(ids).toHaveLength(43);expect(new Set(ids).size).toBe(43);
  await db.query("INSERT INTO return_logistics_events(id,workspace_id,case_id,actor_id,kind,payload) SELECT gen_random_uuid(),$1,$2,$3,'guide',$4 FROM generate_series(1,457)",[ws,id,actor,guide]);await expect(record()).rejects.toThrow('return_logistics_limit');
 });
 it('rejects null context before reading a case',async()=>{
  await expect(scalar('SELECT read_return_logistics(NULL,NULL,NULL,NULL)')).rejects.toThrow('invalid_return_logistics');await expect(scalar('SELECT record_return_logistics(NULL,NULL,NULL,NULL,NULL,NULL,NULL)')).rejects.toThrow('invalid_return_logistics');
 });
});
