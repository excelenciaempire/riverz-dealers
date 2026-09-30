import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const db = new PGlite()
const ws = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const contact = '33333333-3333-4333-8333-333333333333'
const tag = '44444444-4444-4444-8444-444444444444'
const rule = '55555555-5555-4555-8555-555555555555'

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE contacts(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id));
    CREATE TABLE tags(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id));
    CREATE TABLE contact_tags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid REFERENCES contacts(id), tag_id uuid REFERENCES tags(id), UNIQUE(contact_id, tag_id));
    CREATE TABLE automations(id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id), trigger_type text, trigger_config jsonb, is_active boolean, deleted_at timestamptz);
    CREATE TABLE orders(id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id), contact_id uuid REFERENCES contacts(id));
    CREATE TABLE approval_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid REFERENCES workspaces(id), payload jsonb, status text, created_at timestamptz DEFAULT now());
  `)
  await db.exec(readFileSync('supabase/migrations/303_automation_events.sql', 'utf8'))
}, 20000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec('TRUNCATE workspaces CASCADE;')
  await db.query('INSERT INTO workspaces VALUES ($1), ($2)', [ws, other])
  await db.query('INSERT INTO contacts VALUES ($1,$2)', [contact, ws])
  await db.query('INSERT INTO tags VALUES ($1,$2)', [tag, ws])
  await db.query("INSERT INTO automations VALUES ($1,$2,'tag_added',$3,true,null)", [rule, ws, JSON.stringify({ tag_id: tag })])
})

describe('durable automation event queue', () => {
  it('associates approvals through a scoped contact or legacy order payload', async () => {
    const order = '77777777-7777-4777-8777-777777777777'
    await db.query('INSERT INTO orders VALUES ($1,$2,$3)', [order, ws, contact])
    await db.query("INSERT INTO approval_requests(workspace_id,payload,status) VALUES ($1,$2,'pendiente'),($1,$3,'pendiente'),($4,$3,'pendiente')", [ws, JSON.stringify({ contact_id: contact }), JSON.stringify({ order_id: order }), other])
    expect((await db.query('SELECT contact_id FROM approval_requests ORDER BY workspace_id')).rows).toEqual([{ contact_id: contact }, { contact_id: contact }, { contact_id: null }])
  })
  it('captures new tags once, excluding paused and other-workspace rules', async () => {
    await db.query("INSERT INTO automations VALUES (gen_random_uuid(),$1,'tag_added',$2,true,null),(gen_random_uuid(),$3,'tag_added',$2,false,null)", [other, JSON.stringify({ tag_id: tag }), ws])
    await db.query('INSERT INTO contact_tags(contact_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [contact, tag])
    await db.query('INSERT INTO contact_tags(contact_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [contact, tag])
    const rows = (await db.query('SELECT * FROM automation_event_jobs')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ automation_id: rule, workspace_id: ws, context: { tag_id: tag, automation_chain: [] } })
  })
  it('rejects tagging across accounts', async () => {
    await db.query('UPDATE tags SET workspace_id=$1 WHERE id=$2', [other, tag])
    await expect(db.query('INSERT INTO contact_tags(contact_id,tag_id) VALUES ($1,$2)', [contact, tag])).rejects.toThrow('same workspace')
    expect((await db.query('SELECT * FROM automation_event_jobs')).rows).toHaveLength(0)
  })
  it('cuts a remove/add cycle and preserves ancestry for other rules', async () => {
    await db.query('SELECT automation_attach_tag($1,$2,$3,$4)', [ws, contact, tag, JSON.stringify([rule])])
    expect((await db.query('SELECT * FROM automation_event_jobs')).rows).toHaveLength(0)
    await db.query('DELETE FROM contact_tags WHERE contact_id=$1', [contact])
    await db.query('SELECT automation_attach_tag($1,$2,$3,$4)', [ws, contact, tag, JSON.stringify(['66666666-6666-4666-8666-666666666666'])])
    expect((await db.query('SELECT context FROM automation_event_jobs')).rows[0]).toMatchObject({ context: { automation_chain: ['66666666-6666-4666-8666-666666666666'] } })
  })
  it('claims a queued event once and never replays an interrupted send', async () => {
    await db.query('INSERT INTO contact_tags(contact_id,tag_id) VALUES ($1,$2)', [contact, tag])
    expect((await db.query('SELECT * FROM claim_automation_events(40)')).rows).toHaveLength(1)
    expect((await db.query('SELECT * FROM claim_automation_events(40)')).rows).toHaveLength(0)
    await db.exec("UPDATE automation_event_jobs SET claimed_at = now() - interval '16 minutes'")
    expect((await db.query('SELECT * FROM claim_automation_events(40)')).rows).toHaveLength(0)
    expect((await db.query('SELECT status FROM automation_event_jobs')).rows[0]).toEqual({ status: 'uncertain' })
  })
  it('expires unsent events', async () => {
    await db.query('INSERT INTO contact_tags(contact_id,tag_id) VALUES ($1,$2)', [contact, tag])
    await db.exec("UPDATE automation_event_jobs SET expires_at = now() - interval '1 minute'")
    expect((await db.query('SELECT * FROM claim_automation_events(40)')).rows).toHaveLength(0)
    expect((await db.query('SELECT status,reason FROM automation_event_jobs')).rows[0]).toEqual({ status: 'skipped', reason: 'event_expired' })
  })
  it('enqueues each local scheduled slot once and scopes contacts', async () => {
    await db.query("UPDATE automations SET trigger_type='time_based' WHERE id=$1", [rule])
    await db.query('INSERT INTO contacts VALUES (gen_random_uuid(),$1)', [other])
    const first = await db.query('SELECT enqueue_automation_schedule($1,$2) AS n', [rule, 'America/Bogota:2026-09-29T09:30'])
    const second = await db.query('SELECT enqueue_automation_schedule($1,$2) AS n', [rule, 'America/Bogota:2026-09-29T09:30'])
    expect(first.rows[0]).toEqual({ n: 1 }); expect(second.rows[0]).toEqual({ n: 0 })
    expect((await db.query('SELECT contact_id FROM automation_event_jobs')).rows).toEqual([{ contact_id: contact }])
  })
  it('denies untrusted clients access to the worker RPCs and queue', async () => {
    const rows = (await db.query(`SELECT has_function_privilege('authenticated','automation_attach_tag(uuid,uuid,uuid,jsonb)','execute') AS attach,
      has_function_privilege('authenticated','enqueue_automation_schedule(uuid,text)','execute') AS enqueue,
      has_table_privilege('authenticated','automation_event_jobs','insert') AS insert_queue`)).rows
    expect(rows[0]).toEqual({ attach: false, enqueue: false, insert_queue: false })
  })
})
