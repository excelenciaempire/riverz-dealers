import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const db = new PGlite()
const ws = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const owner = '33333333-3333-4333-8333-333333333333'
const agent = '44444444-4444-4444-8444-444444444444'
const outsider = '55555555-5555-4555-8555-555555555555'
const conv = '66666666-6666-4666-8666-666666666666'
const op = '77777777-7777-4777-8777-777777777777'
const team = '88888888-8888-4888-8888-888888888888'
const macro = '99999999-9999-4999-8999-999999999999'

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id),role text DEFAULT 'agent');
    CREATE FUNCTION is_workspace_member(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid()) $$;
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,created_by uuid REFERENCES auth.users(id));
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),contact_id uuid DEFAULT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',channel text DEFAULT 'whatsapp',connection_id uuid REFERENCES channel_connections(id),deleted_at timestamptz,status text DEFAULT 'open',assigned_agent_id uuid REFERENCES auth.users(id));
    CREATE TABLE inbox_saved_filters(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id),config jsonb DEFAULT '{}');
    ALTER TABLE inbox_saved_filters ENABLE ROW LEVEL SECURITY; GRANT SELECT ON inbox_saved_filters TO authenticated;
    CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid,sender_type text DEFAULT 'customer',created_at timestamptz DEFAULT now());
    CREATE TABLE tags(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id));
    CREATE TABLE contact_tags(contact_id uuid,tag_id uuid REFERENCES tags(id),UNIQUE(contact_id,tag_id));
    GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON conversations,channel_connections TO authenticated;
  `)
  await db.exec(readFileSync('supabase/migrations/304_inbox_collaboration.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/307_inbox_followups.sql', 'utf8'))
}, 20000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE workspaces,auth.users,messages,contact_tags CASCADE;')
  await db.query<Record<string, unknown>>('INSERT INTO workspaces VALUES ($1),($2)', [ws, other])
  await db.query<Record<string, unknown>>('INSERT INTO auth.users VALUES ($1),($2),($3)', [owner, agent, outsider])
  await db.query<Record<string, unknown>>("INSERT INTO workspace_members VALUES ($1,$2,'admin'),($1,$3,'agent'),($4,$5,'admin')", [ws, owner, agent, other, outsider])
  await db.query<Record<string, unknown>>('INSERT INTO conversations(id,workspace_id) VALUES ($1,$2)', [conv, ws])
})
const apply = (actions: unknown[], id = op, actor = owner, workspace = ws) => db.query<Record<string, unknown>>('SELECT apply_inbox_actions($1,$2,$3,$4,$5,NULL,NULL) AS result', [id, workspace, conv, actor, JSON.stringify(actions)])
const assign = (ids = [owner, agent], actor: string | null = null, teamId: string | null = null, replace = false) => db.query<Record<string, unknown>>('SELECT assign_inbox_case($1,$2,$3,$4,$5,$6) AS result', [ws, conv, actor, ids, teamId, replace])

describe('durable human follow-ups', () => {
  it('keeps reminders private to their author even when a teammate can read the case', async () => {
    await apply([{ type: 'reminder', minutes: 10, body: 'Private reminder' }])
    await db.query<Record<string, unknown>>("SELECT set_config('request.jwt.claim.sub',$1,false)", [agent])
    await db.exec('SET ROLE authenticated')
    expect((await db.query<Record<string, unknown>>('SELECT * FROM inbox_reminders')).rows).toHaveLength(0)
    expect((await db.query<Record<string, unknown>>('SELECT actions FROM inbox_action_runs')).rows).toHaveLength(0)
    await db.exec('RESET ROLE')
    await db.query<Record<string, unknown>>("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner])
    await db.exec('SET ROLE authenticated')
    expect((await db.query<Record<string, unknown>>('SELECT body FROM inbox_reminders')).rows).toEqual([{ body: 'Private reminder' }])
    expect((await db.query<Record<string, unknown>>('SELECT actions FROM inbox_action_runs')).rows).toHaveLength(1)
    await db.exec('RESET ROLE')
  })
  it('snoozes once, reopens once at the deadline and sends only an internal notification', async () => {
    await apply([{ type: 'snooze', minutes: 60 }]); await apply([{ type: 'snooze', minutes: 60 }])
    expect((await db.query<Record<string, unknown>>('SELECT * FROM inbox_action_runs')).rows).toHaveLength(1)
    await db.query<Record<string, unknown>>("UPDATE conversations SET snoozed_until=now()-interval '1 minute' WHERE id=$1", [conv])
    expect((await db.query<Record<string, unknown>>('SELECT process_due_inbox_followups() AS result')).rows[0].result).toEqual({ snoozes: 1, reminders: 0 })
    expect((await db.query<Record<string, unknown>>('SELECT process_due_inbox_followups() AS result')).rows[0].result).toEqual({ snoozes: 0, reminders: 0 })
    expect((await db.query<Record<string, unknown>>('SELECT status,snoozed_until FROM conversations')).rows[0]).toEqual({ status: 'open', snoozed_until: null })
    expect((await db.query<Record<string, unknown>>('SELECT kind FROM workspace_notifications')).rows).toEqual([{ kind: 'snooze' }])
    expect((await db.query<Record<string, unknown>>('SELECT * FROM messages')).rows).toHaveLength(0)
  })
  it('wakes immediately when the customer sends a new message, without an outbound effect', async () => {
    await apply([{ type: 'snooze', minutes: 60 }])
    await db.query<Record<string, unknown>>("INSERT INTO messages(conversation_id,sender_type) VALUES ($1,'agent')", [conv])
    expect((await db.query<Record<string, unknown>>('SELECT snoozed_until FROM conversations')).rows[0].snoozed_until).not.toBeNull()
    await db.query<Record<string, unknown>>("INSERT INTO messages(conversation_id,sender_type,created_at) VALUES ($1,'customer',now()-interval '2 days')", [conv])
    expect((await db.query<Record<string, unknown>>('SELECT snoozed_until FROM conversations')).rows[0].snoozed_until).not.toBeNull()
    await db.query<Record<string, unknown>>("INSERT INTO messages(conversation_id,sender_type) VALUES ($1,'customer')", [conv])
    expect((await db.query<Record<string, unknown>>('SELECT snoozed_until FROM conversations')).rows[0].snoozed_until).toBeNull()
  })
  it('reminds the requesting user exactly once and cancels a private mailbox they no longer own', async () => {
    await apply([{ type: 'reminder', minutes: 10, body: 'Review delivery' }])
    await db.exec("UPDATE inbox_reminders SET due_at=now()-interval '1 minute'")
    await db.query<Record<string, unknown>>('SELECT process_due_inbox_followups()'); await db.query<Record<string, unknown>>('SELECT process_due_inbox_followups()')
    expect((await db.query<Record<string, unknown>>('SELECT kind,body,user_id FROM workspace_notifications')).rows).toEqual([{ kind: 'reminder', body: 'Review delivery', user_id: owner }])
    await apply([{ type: 'reminder', minutes: 10, body: 'Review personal email' }], macro)
    await db.query<Record<string, unknown>>('INSERT INTO channel_connections VALUES ($1,$2)', [team, agent])
    await db.query<Record<string, unknown>>("UPDATE conversations SET channel='gmail',connection_id=$1 WHERE id=$2", [team, conv])
    await db.exec("UPDATE inbox_reminders SET due_at=now()-interval '1 minute' WHERE status='pending'")
    await db.query<Record<string, unknown>>('SELECT process_due_inbox_followups()')
    expect((await db.query<Record<string, unknown>>('SELECT status FROM inbox_reminders ORDER BY created_at')).rows.map(r => r.status)).toEqual(['completed', 'cancelled'])
    expect((await db.query<Record<string, unknown>>('SELECT * FROM workspace_notifications')).rows).toHaveLength(1)
  })
  it('does not accept a changed request under a completed operation ID or a foreign actor', async () => {
    await apply([{ type: 'resume' }])
    await expect(apply([{ type: 'snooze', minutes: 30 }])).rejects.toThrow('inbox_operation_conflict')
    await expect(apply([{ type: 'resume' }], macro, outsider)).rejects.toThrow('invalid_case_context')
    await expect(apply([{ type: 'resume' }], macro, owner, other)).rejects.toThrow('invalid_case_context')
  })
})

describe('atomic internal macros', () => {
  it('rolls back the note and audit when a subsequent action is invalid', async () => {
    await expect(apply([{ type: 'note', body: 'Prepared case' }, { type: 'charge', amount: 100 }])).rejects.toThrow('invalid_inbox_actions')
    expect((await db.query<Record<string, unknown>>('SELECT * FROM conversation_notes')).rows).toHaveLength(0)
    expect((await db.query<Record<string, unknown>>('SELECT * FROM inbox_action_runs')).rows).toHaveLength(0)
  })
  it('applies the reviewed version and safely recovers its completed result after a macro changes', async () => {
    await db.query<Record<string, unknown>>('INSERT INTO inbox_macros(id,workspace_id,created_by,name,actions) VALUES ($1,$2,$3,$4,$5)', [macro, ws, owner, 'Review return', JSON.stringify([{ type: 'note', body: 'Review policy' }, { type: 'case', priority: 'high', reason: 'return' }])])
    const run = () => db.query<Record<string, unknown>>('SELECT apply_inbox_actions($1,$2,$3,$4,NULL,$5,1) AS result', [op, ws, conv, owner, macro])
    const first = (await run()).rows[0].result
    await db.query<Record<string, unknown>>("UPDATE inbox_macros SET version=2,is_active=false WHERE id=$1", [macro])
    expect((await run()).rows[0].result).toEqual(first)
    expect((await db.query<Record<string, unknown>>('SELECT * FROM conversation_notes')).rows).toHaveLength(1)
    await expect(db.query<Record<string, unknown>>('SELECT apply_inbox_actions($1,$2,$3,$4,NULL,$5,1)', [team, ws, conv, owner, macro])).rejects.toThrow('inbox_macro_changed')
  })
  it('rejects foreign tags and rolls back preceding changes', async () => {
    await db.query<Record<string, unknown>>('INSERT INTO tags VALUES ($1,$2)', [team, other])
    await expect(apply([{ type: 'case', priority: 'urgent', reason: null }, { type: 'tag', tag_id: team }])).rejects.toThrow('invalid_inbox_tag')
    expect((await db.query<Record<string, unknown>>('SELECT case_priority FROM conversations')).rows[0].case_priority).toBe('normal')
    expect((await db.query<Record<string, unknown>>('SELECT * FROM contact_tags')).rows).toHaveLength(0)
  })
})

describe('capacity and availability', () => {
  it('retries a waiting team after capacity returns, without duplicate assignment', async () => {
    await db.query<Record<string, unknown>>('SELECT configure_inbox_team($1,$2,$3,$4,true,$5)', [ws, owner, team, 'Support', [agent]])
    await db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$3,false,true,1)', [ws, owner, agent])
    await assign([], null, team)
    expect((await db.query<Record<string, unknown>>('SELECT dispatch_waiting_inbox_cases() AS n')).rows[0].n).toBe(0)
    await db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$3,true,NULL,NULL)', [ws, agent, agent])
    expect((await db.query<Record<string, unknown>>('SELECT dispatch_waiting_inbox_cases() AS n')).rows[0].n).toBe(1)
    expect((await db.query<Record<string, unknown>>('SELECT dispatch_waiting_inbox_cases() AS n')).rows[0].n).toBe(0)
    expect((await db.query<Record<string, unknown>>('SELECT assigned_agent_id FROM conversations WHERE id=$1', [conv])).rows[0].assigned_agent_id).toBe(agent)
  })
  it('lets automatic round-robin choose current members but never escapes an empty team', async () => {
    expect((await db.query<Record<string, unknown>>('SELECT assign_inbox_case($1,$2,NULL,NULL,NULL,false) AS result', [ws, conv])).rows[0].result).toEqual({ agent_id: owner, outcome: 'assigned' })
    await db.query<Record<string, unknown>>('UPDATE conversations SET assigned_agent_id=NULL WHERE id=$1', [conv])
    await db.query<Record<string, unknown>>('SELECT configure_inbox_team($1,$2,$3,$4,true,$5)', [ws, owner, team, 'Empty team', []])
    expect((await assign([], null, team)).rows[0].result).toEqual({ agent_id: null, outcome: 'waiting' })
  })
  it('chooses only a current member who is enabled, available and below capacity', async () => {
    await db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$3,false,true,1)', [ws, owner, owner])
    expect((await assign([owner, outsider, agent])).rows[0].result).toEqual({ agent_id: agent, outcome: 'assigned' })
    await db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$3,true,false,1)', [ws, owner, agent])
    await db.query<Record<string, unknown>>('UPDATE conversations SET assigned_agent_id=NULL WHERE id=$1', [conv])
    expect((await assign()).rows[0].result).toEqual({ agent_id: null, outcome: 'waiting' })
  })
  it('keeps an unassigned case in its team queue when every eligible member is full', async () => {
    await db.query<Record<string, unknown>>('SELECT configure_inbox_team($1,$2,$3,$4,true,$5)', [ws, owner, team, 'Support', [agent]])
    await db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$3,true,true,1)', [ws, owner, agent])
    await db.query<Record<string, unknown>>('INSERT INTO conversations(id,workspace_id,assigned_agent_id) VALUES ($1,$2,$3)', [op, ws, agent])
    expect((await assign([], owner, team, true)).rows[0].result).toEqual({ agent_id: null, outcome: 'waiting' })
    expect((await db.query<Record<string, unknown>>('SELECT assigned_team_id FROM conversations WHERE id=$1', [conv])).rows[0].assigned_team_id).toBe(team)
    expect((await db.query<Record<string, unknown>>('SELECT * FROM conversations')).rows).toHaveLength(2)
  })
  it('lets an agent set personal availability but not enable themselves or raise capacity', async () => {
    await db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$2,false,NULL,NULL)', [ws, agent])
    await expect(db.query<Record<string, unknown>>('SELECT update_inbox_agent_state($1,$2,$2,true,true,500)', [ws, agent])).rejects.toThrow('invalid_agent_state')
    await expect(db.query<Record<string, unknown>>('SELECT configure_inbox_team($1,$2,$3,$4,true,$5)', [ws, agent, team, 'Unauthorized', [agent]])).rejects.toThrow('invalid_inbox_team')
  })
  it('does not assign a private mailbox to a different available teammate', async () => {
    await db.query<Record<string, unknown>>('INSERT INTO channel_connections VALUES ($1,$2)', [team, owner])
    await db.query<Record<string, unknown>>("UPDATE conversations SET channel='gmail',connection_id=$1 WHERE id=$2", [team, conv])
    expect((await assign([agent])).rows[0].result).toEqual({ agent_id: null, outcome: 'waiting' })
  })
  it('prevents clients from bypassing the service-only command functions', async () => {
    expect((await db.query<Record<string, unknown>>("SELECT has_function_privilege('authenticated','apply_inbox_actions(uuid,uuid,uuid,uuid,jsonb,uuid,integer)','execute') AS apply,has_table_privilege('authenticated','inbox_reminders','insert') AS reminders")).rows[0]).toEqual({ apply: false, reminders: false })
  })
})
