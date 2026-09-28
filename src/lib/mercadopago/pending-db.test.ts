import { beforeAll, afterAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const db = new PGlite()
const ws = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const first = '00000000-0000-4000-8000-000000000003'
const second = '00000000-0000-4000-8000-000000000004'
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT null::uuid';
    CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE workspace_members(workspace_id uuid,user_id uuid);
    CREATE TABLE contacts(id uuid PRIMARY KEY);
    CREATE TABLE automations(id uuid PRIMARY KEY,trigger_type text,trigger_config jsonb,deleted_at timestamptz);
    CREATE TABLE automation_steps(automation_id uuid,step_type text,parent_step_id uuid,step_config jsonb);
    INSERT INTO workspaces VALUES('${ws}'),('${other}');`)
  await db.exec(readFileSync('supabase/migrations/296_mp_pending_payments.sql','utf8'))
}, 30000)
afterAll(async () => db.close())
const claim = async (workspace: string, owner: string, phone = '573001234567') =>
  (await db.query<{ok:boolean}>('SELECT claim_pending_payment_sequence($1,$2,$3) AS ok',[workspace,phone,owner])).rows[0].ok
it('atomically permits only one sequence across competing Mercado Pago and Shopify flows', async () => {
  const results = await Promise.all([claim(ws,first),claim(ws,second)])
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(await claim(ws,first)).toBe(true)
  expect(await claim(ws,second)).toBe(false)
  expect(await claim(other,second)).toBe(true)
})
it('allows the winning sequence follow-ups, not a replay from another flow', async () => {
  expect(await claim(ws,first)).toBe(true)
  expect(await claim(ws,second)).toBe(false)
  expect(await claim(ws,second,'')).toBe(false)
})
it('lets a new purchase start after the shared suppression window ends', async () => {
  await db.query('UPDATE pending_payment_sequences SET expires_at=now()-interval \'1 second\' WHERE workspace_id=$1',[ws])
  expect(await claim(ws,second)).toBe(true)
  expect(await claim(ws,first)).toBe(false)
})
it('source upserts preserve dispatch state and cannot create duplicate payment records', async () => {
  await db.query(`INSERT INTO mp_pending_payments(workspace_id,mp_payment_id,payment_created_at,status,dispatched_at)
    VALUES($1,'123',now(),'pending',now())`,[ws])
  await db.query(`INSERT INTO mp_pending_payments(workspace_id,mp_payment_id,payment_created_at,status)
    VALUES($1,'123',now(),'approved') ON CONFLICT(workspace_id,mp_payment_id) DO UPDATE SET status=EXCLUDED.status`,[ws])
  const result = await db.query<{status:string;dispatched_at:string}>("SELECT status,dispatched_at FROM mp_pending_payments WHERE mp_payment_id='123'")
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0].status).toBe('approved')
  expect(result.rows[0].dispatched_at).toBeTruthy()
})
it('limits the cross-workspace deduplication function to the service role', async () => {
  const result = await db.query<{anon:boolean;authenticated:boolean;service:boolean}>(`SELECT
    has_function_privilege('anon','claim_pending_payment_sequence(uuid,text,uuid)','EXECUTE') AS anon,
    has_function_privilege('authenticated','claim_pending_payment_sequence(uuid,text,uuid)','EXECUTE') AS authenticated,
    has_function_privilege('service_role','claim_pending_payment_sequence(uuid,text,uuid)','EXECUTE') AS service`)
  expect(result.rows[0]).toEqual({ anon:false, authenticated:false, service:true })
})
