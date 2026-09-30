import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest'
const db = new PGlite()
const ws='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', admin='33333333-3333-4333-8333-333333333333'
const agent='44444444-4444-4444-8444-444444444444', conv='55555555-5555-4555-8555-555555555555', order='66666666-6666-4666-8666-666666666666'
const op='77777777-7777-4777-8777-777777777777', op2='88888888-8888-4888-8888-888888888888', mailbox='99999999-9999-4999-8999-999999999999'
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE workspaces(id uuid PRIMARY KEY,writable boolean DEFAULT true);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION is_workspace_member(w uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=w AND user_id=auth.uid()) $$;
    CREATE FUNCTION workspace_billing_write_allowed(w uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT writable FROM workspaces WHERE id=w $$;
    CREATE TABLE channel_connections(id uuid PRIMARY KEY,created_by uuid);
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,channel text DEFAULT 'whatsapp',connection_id uuid,deleted_at timestamptz);
    CREATE TABLE orders(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid,shopify_order_id text DEFAULT '100');
    CREATE TABLE approval_requests(id uuid PRIMARY KEY,workspace_id uuid,kind text,status text,payload jsonb,decided_via text,decided_by uuid,notified_phone text);
    GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON conversations,orders,channel_connections TO authenticated;`)
  await db.exec(readFileSync('supabase/migrations/310_inbox_order_actions.sql','utf8'))
},20000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE workspaces,auth.users,workspace_members,conversations,orders,channel_connections,approval_requests CASCADE;')
  await db.query('INSERT INTO workspaces(id) VALUES($1),($2)',[ws,other])
  await db.query('INSERT INTO auth.users VALUES($1),($2)',[admin,agent])
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'admin'),($1,$3,'agent')",[ws,admin,agent])
  await db.query('INSERT INTO conversations(id,workspace_id,contact_id) VALUES($1,$2,$3)',[conv,ws,agent])
  await db.query('INSERT INTO orders(id,workspace_id,contact_id) VALUES($1,$2,$3)',[order,ws,agent])
})
const action={ type:'refund',amount:25,reason:'Damaged item' }
const save=(id=op,actor=agent,workspace=ws,request=action) => db.query('SELECT (save_inbox_order_preview($1,$2,$3,$4,$5,$6,$7,$8)).*',[id,workspace,conv,order,actor,JSON.stringify(request),'{}','a'.repeat(64)])
const claim=(id=op,actor=admin) => db.query<{ result:{ claimed:boolean; operation:{ status:string } } }>('SELECT claim_inbox_order_action($1,$2,$3,$4) AS result',[id,ws,conv,actor])
const finish=(status='completed') => db.query('SELECT finish_inbox_order_action($1,$2,$3,$4)',[op,ws,status,'{}'])
const approved=async (actor=admin) => db.query("INSERT INTO approval_requests(id,workspace_id,kind,status,payload,decided_via,decided_by,notified_phone) VALUES($1,$2,'reembolsar_pedido','aprobada',$3,'panel',$4,NULL)",[op2,ws,JSON.stringify({ order_id:order,shopify_order_id:'100' }),actor])
const claimApproval=() => db.query<{ claimed:boolean }>('SELECT claim_approved_order_execution($1,$2,$3) AS claimed',[ws,order,op2])

describe('reviewed order operations in PostgreSQL',() => {
  it('saves idempotently, cannot change the request under the same ID, and binds workspace and contact',async () => {
    await save(); await save()
    expect((await db.query('SELECT * FROM inbox_order_actions')).rows).toHaveLength(1)
    await expect(save(op,agent,ws,{ ...action,amount:30 })).rejects.toThrow('order_action_conflict')
    await expect(save(op2,agent,other)).rejects.toThrow('invalid_order_context')
    await db.query('UPDATE orders SET contact_id=$1 WHERE id=$2',[admin,order])
    await expect(save(op2)).rejects.toThrow('invalid_order_context')
  })
  it('lets an agent prepare but requires a current administrator to execute exactly once',async () => {
    await save()
    await expect(claim(op,agent)).rejects.toThrow('order_approval_forbidden')
    expect((await claim()).rows[0].result.claimed).toBe(true)
    expect((await claim()).rows[0].result.claimed).toBe(false)
    await finish()
    expect((await claim()).rows[0].result.operation.status).toBe('completed')
    expect((await db.query('SELECT approved_by FROM inbox_order_actions')).rows).toEqual([{ approved_by:admin }])
  })
  it('expires a preview and never silently refreshes its approved facts',async () => {
    await save(); await db.exec("UPDATE inbox_order_actions SET expires_at=now()-interval '1 minute'")
    expect((await claim()).rows[0].result).toMatchObject({ claimed:false,operation:{ status:'expired' } })
    expect((await db.query('SELECT * FROM order_execution_locks')).rows).toHaveLength(0)
  })
  it('serializes different manual actions and keeps an uncertain external result locked',async () => {
    await save(); await save(op2); await claim()
    await expect(claim(op2)).rejects.toThrow('order_action_busy')
    await finish('uncertain')
    await expect(claim(op2)).rejects.toThrow('order_action_busy')
    expect((await db.query('SELECT status FROM order_execution_locks')).rows).toEqual([{ status:'uncertain' }])
  })
  it('shares one financial lock between assistant approval and the inbox in either order',async () => {
    await save(); await approved()
    expect((await claimApproval()).rows[0].claimed).toBe(true)
    await expect(claim()).rejects.toThrow('order_action_busy')
    await db.query('SELECT finish_approved_order_execution($1,$2,false)',[ws,op2])
    await claim()
    expect((await claimApproval()).rows[0].claimed).toBe(false)
  })
  it('requires explicit administrator review to release an uncertain result and preserves the original outcome',async () => {
    await save(); await claim(); await finish('uncertain')
    const review=(actor=admin) => db.query('SELECT review_order_execution($1,$2,$3,$4,$5,$6,$7)',[ws,conv,order,actor,op,'Verified the provider transaction and remaining balance','{"amount":"75.00"}'])
    await expect(review(agent)).rejects.toThrow('order_approval_forbidden')
    await review()
    expect((await db.query('SELECT status FROM inbox_order_actions')).rows).toEqual([{ status:'reviewed' }])
    expect((await db.query('SELECT reviewed_by,snapshot FROM order_execution_reviews')).rows).toEqual([{ reviewed_by:admin,snapshot:{ amount:'75.00' } }])
    expect((await db.query('SELECT * FROM order_execution_locks')).rows).toHaveLength(0)
    await expect(review()).rejects.toThrow('order_action_conflict')
    await save(op2); expect((await claim(op2)).rows[0].result.claimed).toBe(true)
  })
  it('does not release an operation that is still running',async () => {
    await save(); await claim()
    await expect(db.query('SELECT review_order_execution($1,$2,$3,$4,$5,$6,$7)',[ws,conv,order,admin,op,'Checked','{}'])).rejects.toThrow('order_action_conflict')
    expect((await db.query('SELECT status FROM order_execution_locks')).rows).toEqual([{ status:'running' }])
  })
  it('checks the administrator identity and provider order association of old approvals',async () => {
    await approved(agent)
    await expect(claimApproval()).rejects.toThrow('invalid_order_context')
    await db.query('UPDATE approval_requests SET decided_by=$1,payload=$2',[admin,JSON.stringify({ order_id:order,shopify_order_id:'foreign' })])
    await expect(claimApproval()).rejects.toThrow('invalid_order_context')
    expect((await db.query('SELECT * FROM order_execution_locks')).rows).toHaveLength(0)
  })
  it('protects personal mailboxes for preview, approval and history even after ownership changes',async () => {
    await save()
    await db.query('INSERT INTO channel_connections VALUES($1,$2)',[mailbox,agent])
    await db.query("UPDATE conversations SET channel='gmail',connection_id=$1",[mailbox])
    await expect(claim()).rejects.toThrow('order_approval_forbidden')
    await expect(save(op2,admin)).rejects.toThrow('invalid_order_context')
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[admin]); await db.exec('SET ROLE authenticated')
    expect((await db.query('SELECT * FROM inbox_order_actions')).rows).toHaveLength(0)
    await expect(db.query('SELECT claim_inbox_order_action($1,$2,$3,$4)',[op,ws,conv,admin])).rejects.toThrow('permission denied')
    await db.exec('RESET ROLE')
  })
  it('does not start a financial operation in a read-only workspace',async () => {
    await save(); await approved(); await db.query('UPDATE workspaces SET writable=false WHERE id=$1',[ws])
    await expect(claim()).rejects.toThrow('subscription_read_only')
    await expect(claimApproval()).rejects.toThrow('subscription_read_only')
    await expect(save(op2)).rejects.toThrow('subscription_read_only')
  })
})
