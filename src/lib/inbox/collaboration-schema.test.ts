import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const db = new PGlite()
const ws = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const author = '33333333-3333-4333-8333-333333333333'
const teammate = '44444444-4444-4444-8444-444444444444'
const outsider = '55555555-5555-4555-8555-555555555555'
const conv = '66666666-6666-4666-8666-666666666666'
const note = '77777777-7777-4777-8777-777777777777'

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id), user_id uuid REFERENCES auth.users(id));
    CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
    CREATE TABLE channel_connections(id uuid PRIMARY KEY, created_by uuid REFERENCES auth.users(id));
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),contact_id uuid DEFAULT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',channel text DEFAULT 'whatsapp',connection_id uuid REFERENCES channel_connections(id),deleted_at timestamptz);
    CREATE TABLE inbox_saved_filters(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id),config jsonb DEFAULT '{}');
    ALTER TABLE inbox_saved_filters ENABLE ROW LEVEL SECURITY; GRANT SELECT ON inbox_saved_filters TO authenticated;
    CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid);
    GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON conversations,channel_connections TO authenticated;
  `)
  await db.exec(readFileSync('supabase/migrations/304_inbox_collaboration.sql', 'utf8'))
}, 20000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE workspaces,auth.users CASCADE;')
  await db.query('INSERT INTO workspaces VALUES ($1),($2)', [ws, other])
  await db.query('INSERT INTO auth.users VALUES ($1),($2),($3)', [author, teammate, outsider])
  await db.query('INSERT INTO workspace_members VALUES ($1,$2),($1,$3),($4,$5)', [ws, author, teammate, other, outsider])
  await db.query('INSERT INTO conversations(id,workspace_id) VALUES ($1,$2)', [conv, ws])
})
const add = (mentions: string[] = [teammate], user = author, body = 'Revisar dirección') => db.query('SELECT add_conversation_note($1,$2,$3,$4,$5,$6)', [note, ws, conv, user, body, mentions])

describe('notes and team mentions', () => {
  it('allows personal and explicitly shared views without exposing another workspace', async () => {
    await db.query('INSERT INTO inbox_saved_filters(workspace_id,user_id,is_shared) VALUES ($1,$2,false),($1,$2,true),($1,$3,false),($4,$5,true)', [ws, author, teammate, other, outsider])
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${teammate}',false); SET ROLE authenticated;`)
    expect((await db.query('SELECT user_id,is_shared FROM inbox_saved_filters')).rows).toEqual(expect.arrayContaining([{ user_id: author, is_shared: true }, { user_id: teammate, is_shared: false }]))
    expect((await db.query('SELECT * FROM inbox_saved_filters')).rows).toHaveLength(2)
    await db.exec('RESET ROLE;')
  })
  it('keeps linked-case history and rejects a different contact or foreign workspace', async () => {
    const target = '99999999-9999-4999-8999-999999999999'
    await db.query('INSERT INTO conversations(id,workspace_id) VALUES ($1,$2)', [target, ws])
    await db.query('INSERT INTO conversation_links(workspace_id,source_conversation_id,target_conversation_id,linked_by) VALUES ($1,$2,$3,$4)', [ws, conv, target, author])
    await expect(db.query('INSERT INTO conversation_links(workspace_id,source_conversation_id,target_conversation_id,linked_by) VALUES ($1,$2,$3,$4)', [other, conv, target, author])).rejects.toThrow('invalid_conversation_link')
    await db.query('UPDATE conversation_links SET unlinked_at=now(),unlinked_by=$1', [author])
    await db.query('INSERT INTO conversation_links(workspace_id,source_conversation_id,target_conversation_id,linked_by) VALUES ($1,$2,$3,$4)', [ws, conv, target, author])
    expect((await db.query('SELECT * FROM conversation_links')).rows).toHaveLength(2)
    await db.query("UPDATE conversations SET contact_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE id=$1", [target])
    await expect(db.query('INSERT INTO conversation_links(workspace_id,source_conversation_id,target_conversation_id,linked_by) VALUES ($1,$2,$3,$4)', [ws, conv, target, author])).rejects.toThrow('invalid_conversation_link')
  })
  it('keeps presence monotonic when browser requests arrive out of order', async () => {
    await db.query('SELECT update_conversation_presence($1,$2,$3,$4,true,2)', [ws, conv, author, note])
    await db.query('SELECT update_conversation_presence($1,$2,$3,$4,false,1)', [ws, conv, author, note])
    expect((await db.query('SELECT composing,version FROM conversation_presence')).rows[0]).toEqual({ composing: true, version: 2 })
    await expect(db.query('SELECT update_conversation_presence($1,$2,$3,$4,true,3)', [other, conv, author, note])).rejects.toThrow('invalid_presence_context')
  })
  it('stores a note and one internal notification, without a customer message', async () => {
    await add([teammate, teammate, author])
    expect((await db.query('SELECT * FROM conversation_notes')).rows).toHaveLength(1)
    expect((await db.query('SELECT user_id,note_id FROM workspace_notifications')).rows).toEqual([{ user_id: teammate, note_id: note }])
    expect((await db.query('SELECT * FROM messages')).rows).toEqual([])
  })
  it('makes a retry idempotent and rejects changed content under the same ID', async () => {
    await add(); await add()
    expect((await db.query('SELECT * FROM conversation_notes')).rows).toHaveLength(1)
    expect((await db.query('SELECT * FROM workspace_notifications')).rows).toHaveLength(1)
    await expect(add([teammate], author, 'Different note')).rejects.toThrow('note_id_conflict')
  })
  it('rejects a foreign author or mention atomically', async () => {
    await expect(add([outsider])).rejects.toThrow('invalid_note_context')
    await expect(add([], outsider)).rejects.toThrow('invalid_note_context')
    expect((await db.query('SELECT * FROM conversation_notes')).rows).toHaveLength(0)
    expect((await db.query('SELECT * FROM workspace_notifications')).rows).toHaveLength(0)
  })
  it('restricts personal email notes and mentions to the mailbox owner', async () => {
    const connection = '88888888-8888-4888-8888-888888888888'
    await db.query('INSERT INTO channel_connections VALUES ($1,$2)', [connection, author])
    await db.query("UPDATE conversations SET channel='gmail',connection_id=$1 WHERE id=$2", [connection, conv])
    await expect(add([teammate])).rejects.toThrow('invalid_note_context')
    await expect(add([], teammate)).rejects.toThrow('invalid_note_context')
    await add([])
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${teammate}',false); SET ROLE authenticated;`)
    expect((await db.query('SELECT * FROM conversation_notes')).rows).toHaveLength(0)
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${author}',false); SET ROLE authenticated;`)
    expect((await db.query('SELECT * FROM conversation_notes')).rows).toHaveLength(1)
    await db.exec('RESET ROLE;')
  })
  it('gives each mentioned user access only to their notifications', async () => {
    await add()
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${author}',false); SET ROLE authenticated;`)
    expect((await db.query('SELECT * FROM workspace_notifications')).rows).toHaveLength(0)
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${teammate}',false); SET ROLE authenticated;`)
    expect((await db.query('SELECT * FROM workspace_notifications')).rows).toHaveLength(1)
    await db.exec('RESET ROLE;')
  })
  it('hides an old mention if its conversation becomes a private mailbox or is deleted', async () => {
    await add()
    const connection = '88888888-8888-4888-8888-888888888888'
    await db.query('INSERT INTO channel_connections VALUES ($1,$2)', [connection, author])
    await db.query("UPDATE conversations SET channel='gmail',connection_id=$1 WHERE id=$2", [connection, conv])
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${teammate}',false); SET ROLE authenticated;`)
    expect((await db.query('SELECT * FROM workspace_notifications')).rows).toHaveLength(0)
    await db.exec('RESET ROLE;')
    await db.query("UPDATE conversations SET channel='whatsapp',deleted_at=now() WHERE id=$1", [conv])
    await db.exec(`SET ROLE authenticated;`)
    expect((await db.query('SELECT * FROM workspace_notifications')).rows).toHaveLength(0)
    await db.exec('RESET ROLE;')
  })
  it('prevents direct client writes bypassing the validation RPC', async () => {
    const result = (await db.query(`SELECT has_table_privilege('authenticated','conversation_notes','insert') AS notes,
      has_function_privilege('authenticated','add_conversation_note(uuid,uuid,uuid,uuid,text,uuid[])','execute') AS rpc`)).rows[0]
    expect(result).toEqual({ notes: false, rpc: false })
  })
})
