import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
const db = new PGlite()
const ws='11111111-1111-4111-8111-111111111111', other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor='22222222-2222-4222-8222-222222222222', auto='33333333-3333-4333-8333-333333333333', root='44444444-4444-4444-8444-444444444444', nested='55555555-5555-4555-8555-555555555555', parent='66666666-6666-4666-8666-666666666666'
const sql=readFileSync('supabase/migrations/326_automation_waiting_counts.sql','utf8')
const counts=async(workspace=ws,user:string|null=actor)=> (await db.query<{result:{counts:Record<string,number>;total:number}}>('SELECT automation_waiting_counts($1,$2,$3) AS result',[workspace,auto,user])).rows[0].result
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid);
 CREATE TABLE automations(id uuid PRIMARY KEY,workspace_id uuid,deleted_at timestamptz);
 CREATE TABLE automation_steps(id uuid PRIMARY KEY,automation_id uuid,parent_step_id uuid,branch text,position int,step_type text);
 CREATE TABLE automation_pending_executions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,automation_id uuid,parent_step_id uuid,branch text,next_step_position int,status text);`)
 await db.exec(sql)
},30000)
afterAll(()=>db.close())
beforeEach(async()=>{
 await db.exec('TRUNCATE workspace_members,automations,automation_steps,automation_pending_executions')
 await db.query('INSERT INTO workspace_members VALUES($1,$2)',[ws,actor])
 await db.query('INSERT INTO automations VALUES($1,$2,NULL)',[auto,ws])
 await db.query("INSERT INTO automation_steps VALUES($1,$2,NULL,NULL,0,'wait'),($3,$2,$4,'yes',2,'wait')",[root,auto,nested,parent])
})
describe('waiting counts aggregate all existing scopes without writes',()=>{
 it('counts more than one REST page and keeps nested branches separate',async()=>{
  await db.query("INSERT INTO automation_pending_executions(workspace_id,automation_id,parent_step_id,branch,next_step_position,status) SELECT $1,$2,NULL,NULL,1,'pending' FROM generate_series(1,1201)",[ws,auto])
  await db.query("INSERT INTO automation_pending_executions(workspace_id,automation_id,parent_step_id,branch,next_step_position,status) VALUES($1,$2,$3,'yes',3,'pending'),($1,$2,$3,'yes',3,'pending'),($1,$2,$3,'no',3,'pending'),($4,$2,NULL,NULL,1,'pending'),($1,$5,NULL,NULL,1,'pending'),($1,$2,NULL,NULL,1,'running')",[ws,auto,parent,other,other])
  expect(await counts()).toEqual({counts:{[root]:1201,[nested]:2},total:1203})
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM automation_pending_executions WHERE status='pending'")).rows[0].n).toBe(1206)
 })
 it('returns the existing empty response and never invents zero-key counts',async()=>{
  expect(await counts()).toEqual({counts:{},total:0})
 })
 it('rejects other workspaces, revoked membership and deleted definitions',async()=>{
  await expect(counts(other)).rejects.toThrow('automation_waiting_not_found')
  await db.exec('DELETE FROM workspace_members')
  await expect(counts()).rejects.toThrow('automation_waiting_not_found')
  await db.query('INSERT INTO workspace_members VALUES($1,$2)',[ws,actor])
  await db.query('UPDATE automations SET deleted_at=now() WHERE id=$1',[auto])
  await expect(counts()).rejects.toThrow('automation_waiting_not_found')
 })
 it('is service-only, rejects an invalid actor and can be safely applied twice',async()=>{
  await expect(counts(ws,null)).rejects.toThrow('automation_waiting_not_found')
  await db.exec(sql)
  const result=(await db.query<{anon:boolean;authenticated:boolean;service:boolean}>("SELECT has_function_privilege('anon','automation_waiting_counts(uuid,uuid,uuid)','execute') AS anon,has_function_privilege('authenticated','automation_waiting_counts(uuid,uuid,uuid)','execute') AS authenticated,has_function_privilege('service_role','automation_waiting_counts(uuid,uuid,uuid)','execute') AS service")).rows[0]
  expect(result).toEqual({anon:false,authenticated:false,service:true})
 })
})
