import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite(),ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',agent='44444444-4444-4444-8444-444444444444',conv='55555555-5555-4555-8555-555555555555',op='66666666-6666-4666-8666-666666666666',next='77777777-7777-4777-8777-777777777777',contact='88888888-8888-4888-8888-888888888888',connection='99999999-9999-4999-8999-999999999999'
const phone='123456789',recipient='16505551234',fp='a'.repeat(64)
beforeAll(async() => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text);
    CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
    CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),channel text DEFAULT 'whatsapp',external_id text);
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),channel text DEFAULT 'whatsapp',status text DEFAULT 'connected',config jsonb,external_account_id text);
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),channel text DEFAULT 'whatsapp',contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,connection_id uuid REFERENCES channel_connections(id) ON DELETE SET NULL,deleted_at timestamptz);
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated;`)
  const sql=readFileSync('supabase/migrations/312_inbox_native_blocks.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
  await db.exec('RESET ROLE;TRUNCATE workspaces,auth.users CASCADE;UPDATE billing SET allowed=true;')
  await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,agent]);await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin'),($1,$3,'agent')",[ws,actor,agent])
  await db.query('INSERT INTO contacts(id,workspace_id,external_id) VALUES($1,$2,$3)',[contact,ws,recipient]);await db.query('INSERT INTO channel_connections(id,workspace_id,config) VALUES($1,$2,$3)',[connection,ws,JSON.stringify({ phone_number_id:phone })]);await db.query('INSERT INTO conversations(id,workspace_id,contact_id,connection_id) VALUES($1,$2,$3,$4)',[conv,ws,contact,connection])
})
const prepare=(id=op,user=actor,workspace=ws,desired=true) => db.query('SELECT prepare_inbox_native_block($1,$2,$3,$4,$5,$6,$7,false,$8,$9) AS result',[id,workspace,conv,user,phone,recipient,desired,fp,JSON.stringify({ recipient,phone_number_id:phone })])
const claim=(id=op,fingerprint=fp,user=actor) => db.query<{ result:{ claimed:boolean } }>('SELECT claim_inbox_native_block($1,$2,$3,$4,$5) AS result',[id,ws,conv,user,fingerprint])
const dispatch=(id=op) => db.query<{ result:boolean }>('SELECT authorize_inbox_native_block_dispatch($1,$2,$3,$4) AS result',[id,ws,conv,actor])
const finish=(status:string,result:unknown,id=op) => db.query('SELECT finish_inbox_native_block($1,$2,$3,$4)',[id,ws,status,JSON.stringify(result)])
const review=() => db.query('SELECT review_inbox_native_block($1,$2,$3,$4,$5,$6)',[op,ws,conv,actor,'Reviewed current provider state',JSON.stringify({ blocked:true,recipient,phone_number_id:phone })])
describe('durable native block operations',() => {
  it('prepares without a lock and enforces actor, tenant and source identity',async() => {
    await prepare();expect((await db.query('SELECT * FROM inbox_native_block_locks')).rows).toHaveLength(0)
    await expect(prepare(next,agent)).rejects.toThrow('invalid_native_block');await expect(prepare(next,actor,other)).rejects.toThrow('invalid_native_block')
    await db.query("UPDATE contacts SET external_id='16505559999'");await expect(claim()).rejects.toThrow('invalid_native_block')
  })
  it('claims exactly once and serializes other cases using the same phone and recipient',async() => {
    await prepare();await prepare(next);expect((await claim()).rows[0].result.claimed).toBe(true);expect((await claim()).rows[0].result.claimed).toBe(false)
    await expect(claim(next)).rejects.toThrow('native_block_locked');expect((await dispatch()).rows[0].result).toBe(true);expect((await dispatch()).rows[0].result).toBe(false)
  })
  it('rejects stale previews, expired leases, changed permission and billing',async() => {
    await prepare();await expect(claim(op,'b'.repeat(64))).rejects.toThrow('native_block_changed')
    await db.exec("UPDATE inbox_native_blocks SET expires_at=now()-interval '1 minute'");await expect(claim()).rejects.toThrow('native_block_changed')
    await db.exec("UPDATE inbox_native_blocks SET expires_at=now()+interval '10 minutes'");await claim();await db.exec("UPDATE inbox_native_blocks SET updated_at=now()-interval '61 seconds'")
    expect((await dispatch()).rows[0].result).toBe(false)
    await db.exec('UPDATE billing SET allowed=false');await expect(prepare(next)).rejects.toThrow('subscription_read_only')
    await db.query("UPDATE workspace_members SET role='agent' WHERE user_id=$1",[actor]);await expect(dispatch()).rejects.toThrow('invalid_native_block')
  })
  it('requires an exact receipt and keeps uncertain operations locked until reviewed',async() => {
    await prepare();await claim();await dispatch();await expect(finish('completed',{ blocked:true,recipient:'other',phone_number_id:phone })).rejects.toThrow('invalid_native_block_receipt')
    await finish('uncertain',{ code:'block_uncertain' });await prepare(next);await expect(claim(next)).rejects.toThrow('native_block_locked')
    await review();expect((await db.query('SELECT status FROM inbox_native_blocks WHERE id=$1',[op])).rows).toEqual([{ status:'reviewed' }]);expect((await claim(next)).rows[0].result.claimed).toBe(true)
  })
  it('cannot review running work, but can recover an abandoned lease with a new observed state',async() => {
    await prepare();await claim();await expect(review()).rejects.toThrow('invalid_native_block_review')
    await db.exec("UPDATE inbox_native_blocks SET updated_at=now()-interval '3 minutes'");await review();expect((await dispatch()).rows[0].result).toBe(false)
    await finish('completed',{ blocked:true,recipient,phone_number_id:phone });expect((await db.query('SELECT status FROM inbox_native_blocks')).rows).toEqual([{ status:'reviewed' }])
  })
  it('releases verified completion and explicit failure without claiming extra provider effects',async() => {
    await prepare();await claim();await finish('completed',{ blocked:true,recipient,phone_number_id:phone });expect((await db.query('SELECT * FROM inbox_native_block_locks')).rows).toHaveLength(0)
    await prepare(next);await claim(next);await finish('failed',{ code:'block_rejected' },next);expect((await db.query('SELECT * FROM inbox_native_block_locks')).rows).toHaveLength(0)
  })
  it('keeps locks and receipts when a case or actor is deleted',async() => {
    await prepare();await claim();await db.query('DELETE FROM conversations WHERE id=$1',[conv]);await db.query('DELETE FROM auth.users WHERE id=$1',[actor])
    expect((await db.query('SELECT conversation_id,actor_id,status FROM inbox_native_blocks')).rows).toEqual([{ conversation_id:null,actor_id:null,status:'running' }]);expect((await db.query('SELECT * FROM inbox_native_block_locks')).rows).toHaveLength(1)
  })
  it('hides another workspace audit and makes locks and commands service-only',async() => {
    await prepare();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[agent]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM inbox_native_blocks')).rows).toHaveLength(1)
    await db.exec('RESET ROLE');await db.query('DELETE FROM workspace_members WHERE user_id=$1',[agent]);await db.exec('SET ROLE authenticated');expect((await db.query('SELECT * FROM inbox_native_blocks')).rows).toHaveLength(0)
    expect((await db.query("SELECT has_table_privilege('authenticated','inbox_native_block_locks','select') AS locks,has_function_privilege('authenticated','authorize_inbox_native_block_dispatch(uuid,uuid,uuid,uuid)','execute') AS dispatch")).rows[0]).toEqual({ locks:false,dispatch:false })
  })
})
