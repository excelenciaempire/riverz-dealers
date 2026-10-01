import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {returnHistoryPage} from './history-contract';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',member='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',customer='55555555-5555-4555-8555-555555555555',conv='66666666-6666-4666-8666-666666666666',connection='77777777-7777-4777-8777-777777777777',id='88888888-8888-4888-8888-888888888888';
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
 CREATE TABLE returns(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),contact_id uuid,conversation_id uuid,order_number text,kind text DEFAULT 'devolucion',reason text,status text DEFAULT 'abierta',resolution text,customer_note text,photos jsonb DEFAULT '[]',platform text,decided_by uuid,decided_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 ALTER TABLE returns ENABLE ROW LEVEL SECURITY;CREATE POLICY returns_miembros ON returns FOR ALL TO authenticated USING(public.is_workspace_member(workspace_id));
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE,DELETE ON returns TO anon,authenticated,service_role;
 CREATE FUNCTION touch_returns() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END$$;
 CREATE TRIGGER returns_touch BEFORE UPDATE ON returns FOR EACH ROW EXECUTE FUNCTION touch_returns();`);
 await db.exec(readFileSync('supabase/migrations/327_return_case_history.sql','utf8'));await db.exec(readFileSync('supabase/migrations/351_return_case_authority.sql','utf8'));
},30_000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);TRUNCATE return_case_events,returns,contacts,conversations,channel_connections,workspace_members,workspaces CASCADE");
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,member]);
 await db.query('INSERT INTO contacts VALUES($1,$2)',[customer,ws]);await db.query("INSERT INTO conversations VALUES($1,$2,$3,'whatsapp',NULL,NULL)",[conv,ws,customer]);
 await db.query("INSERT INTO returns(id,workspace_id,contact_id,conversation_id,order_number,resolution,customer_note,photos) VALUES($1,$2,$3,$4,'#42','Preserved note','PRIVATE CUSTOMER TEXT','[\"PRIVATE_URL\"]')",[id,ws,customer,conv]);
});
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const visible=(actor=member,ids:string[]=[id])=>scalar('SELECT visible_return_case_ids($1,$2,$3)',[ws,actor,ids]);
const history=(actor=member,sequence:number|null=null)=>scalar('SELECT read_return_case_history($1,$2,$3,$4)',[ws,actor,id,sequence]);
const decision=(status='aprobada',actor=member,note:string|null=null,replace=false,stamp:string|null=null)=>scalar('SELECT decide_return_case($1,$2,$3,$4,$5,$6,$7)',[ws,actor,id,status,note,replace,stamp]);
describe('Private current return case authority',()=>{
 it('keeps private RPCs and narrows direct authenticated reads and writes',async()=>{
  expect(await scalar('SELECT return_case_authority_ready()')).toBe(true);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[member]);await db.exec('SET ROLE authenticated');
  expect(await scalar('SELECT count(*)::integer FROM returns')).toBe(1);expect(await scalar('SELECT count(*)::integer FROM return_case_events')).toBe(1);
  await expect(decision()).rejects.toThrow('permission denied');await expect(db.exec("UPDATE returns SET status='resuelta'")).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('allows current authorized agents and owners, while preserving omitted resolution and actual attribution',async()=>{
  expect(await visible()).toEqual([id]);const result=await decision();expect(result).toMatchObject({id,status:'aprobada',resolution:'Preserved note',unchanged:false});
  expect(await scalar('SELECT decided_by FROM returns')).toBe(member);expect(await scalar("SELECT actor_id FROM return_case_events WHERE event_type='state_changed'")).toBe(member);
  expect(await visible(owner)).toEqual([id]);
  await decision('recibida',owner);expect(await scalar('SELECT actor_id FROM return_case_events ORDER BY event_sequence DESC LIMIT 1')).toBe(owner);
 });
 it.each(['removed','wrong_section','wrong_role','deleted_workspace'])('denies current %s permission in reads and decisions',async kind=>{
  if(kind==='removed')await db.exec('DELETE FROM workspace_members');if(kind==='wrong_section')await db.exec(`UPDATE workspace_members SET allowed_sections='["/bandeja"]'`);
  if(kind==='wrong_role')await db.exec("UPDATE workspace_members SET role='unknown'");if(kind==='deleted_workspace')await db.exec('UPDATE workspaces SET deleted_at=now()');
  await expect(visible()).rejects.toThrow('return_access_forbidden');await expect(history()).rejects.toThrow('return_not_found');await expect(decision()).rejects.toThrow();expect(await scalar('SELECT status FROM returns')).toBe('abierta');
 });
 it.each(['foreign_contact','foreign_case','deleted_case','mismatched_contact','no_inbox'])('excludes inconsistent case %s',async kind=>{
  if(kind==='foreign_contact')await db.query('UPDATE contacts SET workspace_id=$1',[other]);if(kind==='foreign_case')await db.query('UPDATE conversations SET workspace_id=$1',[other]);if(kind==='deleted_case')await db.exec('UPDATE conversations SET deleted_at=now()');
  if(kind==='mismatched_contact')await db.query('UPDATE conversations SET contact_id=$1',[other]);if(kind==='no_inbox')await db.exec(`UPDATE workspace_members SET allowed_sections='["/devoluciones"]'`);
  expect(await visible()).toEqual([]);await expect(history()).rejects.toThrow('return_not_found');await expect(decision()).rejects.toThrow('return_not_found');
 });
 it.each(['gmail','outlook','zoho'])('protects private %s even from another administrator/owner',async channel=>{
  await db.query('INSERT INTO channel_connections VALUES($1,$2,$3,$4)',[connection,ws,member,channel]);await db.query('UPDATE conversations SET channel=$1,connection_id=$2',[channel,connection]);
  expect(await visible(owner)).toEqual([]);expect(await visible()).toEqual([id]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('SET ROLE authenticated');expect(await scalar('SELECT count(*)::integer FROM returns')).toBe(0);expect(await scalar('SELECT count(*)::integer FROM return_case_events')).toBe(0);await db.exec('RESET ROLE');
 });
 it('allows non-conversational returns with Returns permission while protecting conversation-bound cases',async()=>{
  await db.exec(`UPDATE workspace_members SET allowed_sections='["/devoluciones"]'`);expect(await visible()).toEqual([]);await db.exec('UPDATE returns SET conversation_id=NULL');expect(await visible()).toEqual([id]);
 });
 it('keeps provider-managed cases read-only and preserves the existing state graph',async()=>{
  await db.exec("UPDATE returns SET platform='mercadolibre'");await expect(decision()).rejects.toThrow('return_platform_managed');await db.exec('UPDATE returns SET platform=NULL');
  await expect(decision('resuelta')).rejects.toThrow('invalid_return_transition');await decision();await decision('recibida');await decision('resuelta');await expect(decision('abierta')).rejects.toThrow('invalid_return_transition');
 });
 it('compares exact microseconds and makes identical retries immutable',async()=>{
  const stamp=await scalar('SELECT updated_at::text FROM returns') as string;const result=await decision('aprobada',member,null,false,stamp);expect(result).toMatchObject({unchanged:false});
  expect(await decision('aprobada',owner,null,false,stamp)).toMatchObject({unchanged:true});expect(await scalar('SELECT decided_by FROM returns')).toBe(member);
  await expect(decision('recibida',member,null,false,stamp)).rejects.toThrow('return_decision_changed');
 });
 it('requires current writable billing only for a changed decision',async()=>{
  await db.exec('UPDATE workspaces SET writable=false');await expect(decision()).rejects.toThrow('return_subscription_read_only');expect(await decision('abierta')).toMatchObject({unchanged:true});
 });
 it('keeps note replacement/removal explicit and the audit in the transaction',async()=>{
  await decision('aprobada',member,' Revised ',true);expect(await scalar('SELECT resolution FROM returns')).toBe('Revised');await decision('aprobada',member,null,true);expect(await scalar('SELECT resolution FROM returns')).toBeNull();
  expect(await scalar('SELECT count(*)::integer FROM return_case_events')).toBe(3);
 });
 it('serializes history without raw customer notes, photo URLs or foreign identities',async()=>{
  const data=returnHistoryPage.parse(await history());expect(data.events[0]).toMatchObject({photo_count:1,status:'abierta'});expect(JSON.stringify(data)).not.toMatch(/PRIVATE|snapshot|workspace_id/);
 });
 it('paginates tied timestamps by event sequence without omissions',async()=>{
  for(let n=1;n<=42;n++)await db.query('UPDATE returns SET resolution=$1',[String(n)]);
  const ids:string[]=[];let cursor:number|null=null;
  do{const data=returnHistoryPage.parse(await history(member,cursor));ids.push(...data.events.map(row=>row.id));cursor=data.next_cursor?JSON.parse(data.next_cursor).event_sequence:null;}while(cursor);
  expect(ids).toHaveLength(43);expect(new Set(ids).size).toBe(43);
 });
 it('rejects null actor, oversized scope and null array members before reading cases',async()=>{
  await expect(scalar('SELECT visible_return_case_ids($1,NULL,$2)',[ws,[id]])).rejects.toThrow('invalid_return_context');await expect(visible(member,Array(201).fill(id))).rejects.toThrow('invalid_return_context');await expect(scalar('SELECT visible_return_case_ids($1,$2,ARRAY[NULL]::uuid[])',[ws,member])).rejects.toThrow('invalid_return_context');
 });
});
