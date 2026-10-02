import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',product='55555555-5555-4555-8555-555555555555',event='66666666-6666-4666-8666-666666666666',event2='77777777-7777-4777-8777-777777777777',agent='88888888-8888-4888-8888-888888888888';
const policy={mode:'allow',window_days:30,starts_at:'delivery',remedies:['refund','exchange'],conditions:'Team inspection required'};
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
const read=(who=actor)=>scalar('SELECT read_product_return_policy($1,$2,$3)',[ws,who,product]);
const write=(revision=0,body:unknown=policy,id=event,who=owner)=>scalar('SELECT write_product_return_policy($1,$2,$3,$4,$5,$6)',[ws,who,product,id,revision,body]);
const machine=(ids=[product])=>scalar('SELECT read_agent_product_return_policies($1,$2,$3)',[ws,agent,ids]);
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz,writable boolean DEFAULT true);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,allowed_sections jsonb);
 CREATE TABLE shopify_products(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id));
 CREATE TABLE ai_agents(id uuid PRIMARY KEY,workspace_id uuid,is_active boolean,product_scope text);
 CREATE TABLE ai_agent_products(agent_id uuid,product_id uuid);
 CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT writable FROM public.workspaces WHERE id=ws$$;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/354_product_return_policies.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE ai_agent_products,ai_agents,workspace_members,shopify_products,workspaces CASCADE');
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$3)',[ws,owner,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$2,'agent',NULL)",[ws,actor]);
 await db.query('INSERT INTO shopify_products VALUES($1,$2),($3,$3)',[product,ws,other]);
 await db.query("INSERT INTO ai_agents VALUES($1,$2,true,'all')",[agent,ws]);
});
describe('Private versioned product return declarations',()=>{
 it('keeps both tables and all functions private with fixed search paths',async()=>{
  expect(await scalar('SELECT product_return_policy_ready()')).toBe(true);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`SET ROLE ${role}`);for(const table of ['product_return_policies','product_return_policy_events'])await expect(db.exec(`SELECT * FROM ${table}`)).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE authenticated');await expect(read()).rejects.toThrow('permission denied');await expect(write()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 });
 it('reads an absent override without inventing a policy and reports current edit access',async()=>{
  expect(await read()).toEqual({snapshot:{product_id:product,revision:0,policy:null,changed_at:null},can_edit:false});expect(await read(owner)).toMatchObject({can_edit:true});
 });
 it('saves exactly version one and audit in the same transaction for the actual owner without an extra member',async()=>{
  expect(await write()).toMatchObject({product_id:product,revision:1,policy});expect(await scalar('SELECT actor_id FROM product_return_policy_events')).toBe(owner);
  expect(await read()).toMatchObject({snapshot:{revision:1,policy},can_edit:false});
 });
 it('rejects agent writes, removed admin access and malformed sections',async()=>{
  await expect(write(0,policy,event,actor)).rejects.toThrow('product_return_policy_not_found');await db.exec("UPDATE workspace_members SET role='admin',allowed_sections='[\"/productos\"]'");
  await write(0,policy,event,actor);await db.exec("UPDATE workspace_members SET allowed_sections='{}'");await expect(read()).rejects.toThrow('product_return_policy_not_found');await expect(write(1,policy,event2,actor)).rejects.toThrow('product_return_policy_not_found');
 });
 it.each(['foreign_product','foreign_actor','deleted_workspace'])('blocks %s without reading or writing another business',async mode=>{
  if(mode==='foreign_product')await db.query('UPDATE shopify_products SET workspace_id=$1 WHERE id=$2',[other,product]);
  if(mode==='foreign_actor')await db.exec('DELETE FROM workspace_members');if(mode==='deleted_workspace')await db.exec('UPDATE workspaces SET deleted_at=now()');
  await expect(read()).rejects.toThrow();await expect(write(0,policy,event,actor)).rejects.toThrow();expect(await scalar('SELECT count(*) FROM product_return_policies')).toBe(0);
 });
 it('makes same-id retries immutable, even if billing or the current version changes',async()=>{
  const first=await write();await write(1,{...policy,window_days:20},event2);await db.exec('UPDATE workspaces SET writable=false');expect(await write()).toEqual(first);
  expect(await scalar('SELECT count(*) FROM product_return_policy_events')).toBe(2);expect(await read(owner)).toMatchObject({snapshot:{revision:2,policy:{window_days:20}}});
 });
 it('rejects identifier reuse with changed policy, expected revision or actor',async()=>{
  await write();await expect(write(0,{...policy,window_days:20})).rejects.toThrow('product_return_policy_changed');await expect(write(1)).rejects.toThrow('product_return_policy_changed');
  await db.exec("UPDATE workspace_members SET role='admin'");await expect(write(0,policy,event,actor)).rejects.toThrow('product_return_policy_changed');
 });
 it('detects a stale version and withdraws with a new version while retaining the audit',async()=>{
  await write();await expect(write(0,null,event2)).rejects.toThrow('product_return_policy_changed');expect(await write(1,null,event2)).toMatchObject({revision:2,policy:null});
  expect(await scalar('SELECT policy FROM product_return_policy_events WHERE revision=1')).toEqual(policy);expect(await read(owner)).toMatchObject({snapshot:{revision:2,policy:null}});
 });
 it('checks writable billing before a new edit and rolls back both surfaces on audit failure',async()=>{
  await db.exec('UPDATE workspaces SET writable=false');await expect(write()).rejects.toThrow('product_return_policy_read_only');expect(await scalar('SELECT count(*) FROM product_return_policy_events')).toBe(0);
  await db.exec(`UPDATE workspaces SET writable=true;CREATE FUNCTION fail_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic audit failure';END$$;
   CREATE TRIGGER fail_policy_audit BEFORE INSERT ON product_return_policy_events FOR EACH ROW EXECUTE FUNCTION fail_policy_audit();`);
  await expect(write()).rejects.toThrow('synthetic audit failure');expect(await scalar('SELECT count(*) FROM product_return_policies')).toBe(0);await db.exec('DROP TRIGGER fail_policy_audit ON product_return_policy_events;DROP FUNCTION fail_policy_audit()');
 });
 it.each([{...policy,mode:null},{...policy,starts_at:null},{...policy,window_days:0},{...policy,window_days:366},{...policy,remedies:['refund','refund']},{...policy,remedies:[null]},{...policy,conditions:null},{...policy,approved:true}])('rejects malformed SQL input independently of the TypeScript parser',async value=>{
  await expect(write(0,value)).rejects.toThrow('invalid_product_return_policy');expect(await scalar('SELECT count(*) FROM product_return_policy_events')).toBe(0);
 });
 it('rejects null identities and excess or foreign machine products',async()=>{
  await expect(scalar('SELECT read_product_return_policy(NULL,NULL,NULL)')).rejects.toThrow('invalid_product_return_policy');await expect(machine([other])).rejects.toThrow('product_return_policy_not_found');
  await expect(machine(Array(81).fill(product))).rejects.toThrow('invalid_product_return_policy');expect(await machine([])).toEqual([]);
 });
 it('reads only the current active assistant scope and assignment',async()=>{
  await write();expect(await machine()).toMatchObject([{product_id:product,revision:1,policy}]);await db.exec("UPDATE ai_agents SET product_scope='specific'");await expect(machine()).rejects.toThrow('product_return_policy_not_found');
  await db.query('INSERT INTO ai_agent_products VALUES($1,$2)',[agent,product]);expect(await machine()).toMatchObject([{product_id:product,policy}]);await db.exec('UPDATE ai_agents SET is_active=false');await expect(machine()).rejects.toThrow('product_return_policy_not_found');
 });
 it('removes policy storage with its product without editing any catalog or order data',async()=>{
  await write();await db.query('DELETE FROM shopify_products WHERE id=$1',[product]);expect(await scalar('SELECT count(*) FROM product_return_policies')).toBe(0);expect(await scalar('SELECT count(*) FROM product_return_policy_events')).toBe(0);
 });
});
