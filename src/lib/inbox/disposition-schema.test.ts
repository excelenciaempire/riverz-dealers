import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
const db=new PGlite()
const ws='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',teammate='44444444-4444-4444-8444-444444444444',conv='55555555-5555-4555-8555-555555555555',op='66666666-6666-4666-8666-666666666666',next='77777777-7777-4777-8777-777777777777'
beforeAll(async() => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,created_by uuid REFERENCES auth.users(id));
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),channel text DEFAULT 'whatsapp',connection_id uuid REFERENCES channel_connections(id),deleted_at timestamptz,unread_count integer DEFAULT 0,ai_enabled boolean DEFAULT true,status text DEFAULT 'pending',updated_at timestamptz DEFAULT now());
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT allowed FROM billing $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT,UPDATE ON conversations TO authenticated;GRANT SELECT ON channel_connections TO authenticated;`)
  const sql=readFileSync('supabase/migrations/311_inbox_disposition.sql','utf8');await db.exec(sql);await db.exec(sql)
},20000)
afterAll(async() => { await db.close() })
beforeEach(async() => {
  await db.exec('RESET ROLE;TRUNCATE workspaces,auth.users CASCADE;UPDATE billing SET allowed=true;')
  await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);await db.query('INSERT INTO auth.users VALUES($1),($2)',[actor,teammate])
  await db.query('INSERT INTO workspace_members VALUES($1,$2),($1,$3)',[ws,actor,teammate]);await db.query('INSERT INTO conversations(id,workspace_id) VALUES($1,$2)',[conv,ws])
})
const apply=(action:string,version=0,id=op,user=actor,workspace=ws) => db.query<{ result:Record<string,unknown> }>('SELECT set_inbox_disposition($1,$2,$3,$4,$5,$6) AS result',[id,workspace,conv,user,action,version])
describe('atomic and private inbox controls',() => {
  it('marks once, returns its receipt on retry and rejects a reused ID',async() => {
    const first=(await apply('unread')).rows[0].result
    expect(first).toEqual({ manual_unread:true,unread_count:1,is_spam:false,version:1 })
    expect((await apply('unread')).rows[0].result).toEqual(first)
    await expect(apply('spam')).rejects.toThrow('inbox_disposition_conflict')
    expect((await db.query('SELECT count(*)::integer AS n FROM inbox_disposition_events')).rows).toEqual([{ n:1 }])
  })
  it('prevents a stale teammate from overwriting a newer choice',async() => {
    await apply('spam');await expect(apply('restore',0,next,teammate)).rejects.toThrow('inbox_disposition_changed')
    expect((await apply('restore',1,next,teammate)).rows[0].result.is_spam).toBe(false)
  })
  it('preserves original assistant and case state on spam and restore',async() => {
    await db.exec('UPDATE conversations SET ai_enabled=false,unread_count=3')
    await apply('spam');await apply('restore',1,next)
    expect((await db.query('SELECT ai_enabled,status,unread_count FROM conversations')).rows).toEqual([{ ai_enabled:false,status:'pending',unread_count:3 }])
  })
  it('permits reading while billing is read-only, preventing other edits atomically',async() => {
    await apply('unread');await db.exec('UPDATE billing SET allowed=false')
    await expect(apply('spam',1,next)).rejects.toThrow('subscription_read_only')
    expect((await apply('read',1,next)).rows[0].result).toEqual({ manual_unread:false,unread_count:0,is_spam:false,version:2 })
  })
  it('rejects foreign workspace, nonmembers, deleted cases and private mailboxes',async() => {
    await expect(apply('spam',0,op,actor,other)).rejects.toThrow('invalid_inbox_disposition')
    await db.query('DELETE FROM workspace_members WHERE user_id=$1',[teammate]);await expect(apply('spam',0,op,teammate)).rejects.toThrow('invalid_inbox_disposition')
    await db.query('INSERT INTO channel_connections VALUES($1,$2)',[next,teammate]);await db.query("UPDATE conversations SET channel='gmail',connection_id=$1",[next])
    await expect(apply('spam')).rejects.toThrow('invalid_inbox_disposition')
    await db.exec('UPDATE conversations SET deleted_at=now()');await expect(apply('spam')).rejects.toThrow('invalid_inbox_disposition')
  })
  it('limits audit visibility to current members and the actual mailbox owner',async() => {
    await db.query('INSERT INTO channel_connections VALUES($1,$2)',[next,actor]);await db.query("UPDATE conversations SET channel='gmail',connection_id=$1",[next]);await apply('spam')
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[teammate]);await db.exec('SET ROLE authenticated')
    expect((await db.query('SELECT * FROM inbox_disposition_events')).rows).toHaveLength(0)
    await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated')
    expect((await db.query('SELECT * FROM inbox_disposition_events')).rows).toHaveLength(1)
  })
  it('prevents direct client controls and unaudited RPC calls',async() => {
    expect((await db.query("SELECT has_function_privilege('authenticated','set_inbox_disposition(uuid,uuid,uuid,uuid,text,bigint)','execute') AS execute,has_table_privilege('authenticated','inbox_disposition_events','insert') AS insert")).rows[0]).toEqual({ execute:false,insert:false })
    await db.exec('SET ROLE authenticated');await expect(db.exec('UPDATE conversations SET is_spam=true')).rejects.toThrow('inbox_disposition_command_required')
    await db.exec('UPDATE conversations SET unread_count=0')
  })
  it('retains audit after account deletion without blocking deletion',async() => {
    await apply('spam');await db.query('DELETE FROM auth.users WHERE id=$1',[actor])
    expect((await db.query('SELECT actor_id,action FROM inbox_disposition_events')).rows).toEqual([{ actor_id:null,action:'spam' }])
  })
})
