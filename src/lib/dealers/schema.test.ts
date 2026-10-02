import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const ws = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  user = '30000000-0000-4000-8000-000000000001';
const contact = '40000000-0000-4000-8000-000000000001',
  foreign = '40000000-0000-4000-8000-000000000002';
let db: PGlite;
async function vehicle(stock: string, workspace = ws) {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO dealer_vehicles(workspace_id,stock_number,make,model,year,price) VALUES($1,$2,'Toyota','Camry',2023,23000) RETURNING id`,
      [workspace, stock]
    )
  ).rows[0].id;
}
async function opportunity(c = contact) {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO dealer_opportunities(workspace_id,contact_id,next_follow_up_at) VALUES($1,$2,now()+interval '1 day') RETURNING id`,
      [ws, c]
    )
  ).rows[0].id;
}
async function appointment(o: string, v: string, hours = 2) {
  return db.query<{ id: string }>(
    `INSERT INTO dealer_appointments(workspace_id,opportunity_id,vehicle_id,seller_id,starts_at,ends_at,location,status) VALUES($1,$2,$3,$4,now()+make_interval(hours => $5),now()+make_interval(hours => $5)+interval '30 minutes','Showroom','confirmed') RETURNING id`,
    [ws, o, v, user, hours]
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.uid',true),'')::uuid $$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users(id),timezone text DEFAULT 'America/New_York');
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id));
    CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),opted_out boolean DEFAULT false);
    CREATE FUNCTION is_workspace_member(p_workspace uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=auth.uid()) $$;
    INSERT INTO auth.users VALUES('${user}'); INSERT INTO workspaces(id,owner_id) VALUES('${ws}','${user}'),('${other}','${user}');
    INSERT INTO workspace_members VALUES('${ws}','${user}'); INSERT INTO contacts VALUES('${contact}','${ws}',false),('${foreign}','${other}',false);
    GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON contacts,workspace_members TO authenticated;`);
  await db.exec(readFileSync('supabase/migrations/375_dealers.sql', 'utf8'));
  await db.exec(`CREATE TABLE automations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,trigger_type text,is_active boolean DEFAULT false,deleted_at timestamptz);
    CREATE TABLE automation_event_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,automation_id uuid,contact_id uuid,
      event_type text CHECK(event_type IN ('tag_added','time_based')),event_key text,context jsonb,expires_at timestamptz,UNIQUE(automation_id,contact_id,event_key));`);
  await db.exec(
    readFileSync('supabase/migrations/376_dealer_automations.sql', 'utf8')
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('dealer SQL invariants', () => {
  it('rejects a cross-workspace contact even as service owner', async () => {
    await expect(opportunity(foreign)).rejects.toThrow('dealer_reference');
  });
  it('atomically rolls back an opportunity with a foreign vehicle', async () => {
    const v = await vehicle('FOREIGN', other);
    const p = {
      contact_id: contact,
      stage: 'inquiry',
      budget: 20000,
      currency: 'USD',
      preferences: 'SUV',
      buying_timeframe: 'Soon',
      financing: false,
      trade_in: '',
      next_follow_up_at: null,
      follow_up_note: '',
      follow_up_paused: false,
      vehicle_ids: [v],
    };
    await expect(
      db.query('SELECT dealer_save_opportunity($1,NULL,$2::jsonb)', [
        ws,
        JSON.stringify(p),
      ])
    ).rejects.toThrow();
    expect(
      (await db.query('SELECT id FROM dealer_opportunities')).rows
    ).toHaveLength(0);
  });
  it('enforces seller conflicts, supports adjacent slots and blocks unavailable vehicles', async () => {
    const o = await opportunity(),
      v = await vehicle('A'),
      v2 = await vehicle('B');
    await appointment(o, v);
    await expect(appointment(o, v2)).rejects.toThrow('dealer_conflict');
    await appointment(o, v2, 3);
    await db.query("UPDATE dealer_vehicles SET status='reserved' WHERE id=$1", [
      v2,
    ]);
    await expect(appointment(o, v2, 5)).rejects.toThrow('dealer_unavailable');
    const cancelled = await db.query<{ status: string }>(
      'SELECT status FROM dealer_appointments WHERE vehicle_id=$1',
      [v2]
    );
    expect(cancelled.rows[0].status).toBe('cancelled');
  });
  it('rechecks availability and seller conflicts when moving an existing appointment', async () => {
    const a = (
      await db.query<{ id: string; opportunity_id: string }>(
        "SELECT a.id,a.opportunity_id FROM dealer_appointments a JOIN dealer_vehicles v ON v.id=a.vehicle_id WHERE v.stock_number='A'"
      )
    ).rows[0];
    const v = await vehicle('RESCHEDULE');
    await appointment(a.opportunity_id, v, 5);
    await db.query(
      "UPDATE dealer_appointments SET starts_at=now()+interval '4 hours',ends_at=now()+interval '4 hours 30 minutes' WHERE id=$1",
      [a.id]
    );
    const previous = (
      await db.query('SELECT starts_at FROM dealer_appointments WHERE id=$1', [
        a.id,
      ])
    ).rows[0];
    await expect(
      db.query(
        "UPDATE dealer_appointments SET starts_at=now()+interval '5 hours',ends_at=now()+interval '5 hours 30 minutes' WHERE id=$1",
        [a.id]
      )
    ).rejects.toThrow('dealer_conflict');
    expect(
      (
        await db.query(
          'SELECT starts_at FROM dealer_appointments WHERE id=$1',
          [a.id]
        )
      ).rows[0]
    ).toEqual(previous);
    await expect(
      db.query('UPDATE dealer_appointments SET vehicle_id=$1 WHERE id=$2', [
        v,
        a.id,
      ])
    ).rejects.toThrow('dealer_reference');
  });
  it('pauses follow-ups when a vehicle is sold', async () => {
    const o = (
        await db.query<{ id: string }>('SELECT id FROM dealer_opportunities')
      ).rows[0].id,
      v = (
        await db.query<{ id: string }>(
          "SELECT id FROM dealer_vehicles WHERE stock_number='A'"
        )
      ).rows[0].id;
    await db.query('INSERT INTO dealer_interests VALUES($1,$2,$3)', [ws, o, v]);
    await db.query("UPDATE dealer_vehicles SET status='sold' WHERE id=$1", [v]);
    expect(
      (
        await db.query<{ follow_up_paused: boolean; next_follow_up_at: null }>(
          'SELECT follow_up_paused,next_follow_up_at FROM dealer_opportunities'
        )
      ).rows[0]
    ).toEqual({ follow_up_paused: true, next_follow_up_at: null });
  });
  it('applies opt-out to scheduling and follow-up', async () => {
    await db.query('UPDATE contacts SET opted_out=true WHERE id=$1', [contact]);
    const o = (
        await db.query<{ id: string }>('SELECT id FROM dealer_opportunities')
      ).rows[0].id,
      v = await vehicle('C');
    await expect(appointment(o, v, 6)).rejects.toThrow('dealer_closed');
    await db.query('UPDATE contacts SET opted_out=false WHERE id=$1', [
      contact,
    ]);
  });
  it('closing an opportunity cancels pending appointments and prevents new bookings', async () => {
    const o = (
        await db.query<{ id: string }>('SELECT id FROM dealer_opportunities')
      ).rows[0].id,
      v = await vehicle('D');
    await appointment(o, v, 7);
    await db.query("UPDATE dealer_opportunities SET stage='won' WHERE id=$1", [
      o,
    ]);
    expect(
      (
        await db.query<{ status: string }>(
          'SELECT status FROM dealer_appointments WHERE vehicle_id=$1',
          [v]
        )
      ).rows[0].status
    ).toBe('cancelled');
    await expect(appointment(o, v, 8)).rejects.toThrow('dealer_closed');
  });
  it('RLS isolates reads and writes from a non-member workspace', async () => {
    await db.exec(`SET ROLE authenticated; SET app.uid='${user}';`);
    expect(
      (
        await db.query('SELECT id FROM dealer_vehicles WHERE workspace_id=$1', [
          other,
        ])
      ).rows
    ).toHaveLength(0);
    await expect(vehicle('ATTACK', other)).rejects.toThrow(
      /row-level security/
    );
    await db.exec('RESET ROLE');
  });
});

describe.sequential('durable dealer automation events', () => {
  let o: string, a: string;
  it('queues only active tenant automations once per follow-up date and confirmed appointment', async () => {
    o = await opportunity();
    await db.query(
      "UPDATE dealer_opportunities SET next_follow_up_at=now()-interval '1 minute' WHERE id=$1",
      [o]
    );
    const v = await vehicle('REMINDER');
    a = (await appointment(o, v, 10)).rows[0].id;
    await db.query(
      "INSERT INTO automations(workspace_id,trigger_type,is_active) VALUES($1,'dealer_follow_up_due',true),($1,'dealer_appointment_reminder',true),($1,'dealer_follow_up_due',false),($2,'dealer_follow_up_due',true)",
      [ws, other]
    );
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT enqueue_dealer_automation_events() AS n'
        )
      ).rows[0].n
    ).toBe(2);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT enqueue_dealer_automation_events() AS n'
        )
      ).rows[0].n
    ).toBe(0);
    const jobs = (
      await db.query<{
        workspace_id: string;
        contact_id: string;
        event_type: string;
        context: { vars: Record<string, string> };
      }>('SELECT * FROM automation_event_jobs')
    ).rows;
    expect(jobs).toHaveLength(2);
    expect(
      jobs.every((j) => j.workspace_id === ws && j.contact_id === contact)
    ).toBe(true);
    for (const job of jobs)
      expect(
        (
          await db.query<{ ok: boolean }>(
            'SELECT dealer_automation_allowed($1,$2,$3,$4::jsonb) AS ok',
            [ws, contact, job.event_type, JSON.stringify(job.context.vars)]
          )
        ).rows[0].ok
      ).toBe(true);
    const reminder = jobs.find(
      (j) => j.event_type === 'dealer_appointment_reminder'
    )!;
    expect(reminder.context.vars.appointment_at).toContain('America/New_York');
    expect(
      (
        await db.query<{ ok: boolean }>(
          'SELECT dealer_automation_allowed($1,$2,$3,$4::jsonb) AS ok',
          [
            other,
            contact,
            reminder.event_type,
            JSON.stringify(reminder.context.vars),
          ]
        )
      ).rows[0].ok
    ).toBe(false);
  });
  async function allowed(event: string) {
    const job = (
      await db.query<{ context: { vars: Record<string, string> } }>(
        'SELECT context FROM automation_event_jobs WHERE event_type=$1 ORDER BY expires_at LIMIT 1',
        [event]
      )
    ).rows[0];
    return (
      await db.query<{ ok: boolean }>(
        'SELECT dealer_automation_allowed($1,$2,$3,$4::jsonb) AS ok',
        [ws, contact, event, JSON.stringify(job.context.vars)]
      )
    ).rows[0].ok;
  }
  it('invalidates old messages after rescheduling either a follow-up or an appointment', async () => {
    await db.query(
      "UPDATE dealer_opportunities SET next_follow_up_at=now()-interval '2 minutes' WHERE id=$1",
      [o]
    );
    expect(await allowed('dealer_follow_up_due')).toBe(false);
    await db.query(
      "UPDATE dealer_appointments SET starts_at=now()+interval '11 hours',ends_at=now()+interval '11 hours 30 minutes' WHERE id=$1",
      [a]
    );
    expect(await allowed('dealer_appointment_reminder')).toBe(false);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT enqueue_dealer_automation_events() AS n'
        )
      ).rows[0].n
    ).toBe(2);
  });
  it('invalidates a stale reminder when the location changes without moving the time', async () => {
    const job = (
      await db.query<{ context: { vars: Record<string, string> } }>(
        "SELECT context FROM automation_event_jobs WHERE event_type='dealer_appointment_reminder' ORDER BY expires_at DESC LIMIT 1"
      )
    ).rows[0];
    await db.query(
      "UPDATE dealer_appointments SET location='New showroom' WHERE id=$1",
      [a]
    );
    expect(
      (
        await db.query<{ ok: boolean }>(
          'SELECT dealer_automation_allowed($1,$2,$3,$4::jsonb) AS ok',
          [
            ws,
            contact,
            'dealer_appointment_reminder',
            JSON.stringify(job.context.vars),
          ]
        )
      ).rows[0].ok
    ).toBe(false);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT enqueue_dealer_automation_events() AS n'
        )
      ).rows[0].n
    ).toBe(1);
  });
  it('stops dispatch for paused, opted-out and closed buyers', async () => {
    await db.query(
      'UPDATE dealer_opportunities SET follow_up_paused=true WHERE id=$1',
      [o]
    );
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT enqueue_dealer_automation_events() AS n'
        )
      ).rows[0].n
    ).toBe(0);
    expect(await allowed('dealer_appointment_reminder')).toBe(false);
    await db.query('UPDATE contacts SET opted_out=true WHERE id=$1', [contact]);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT enqueue_dealer_automation_events() AS n'
        )
      ).rows[0].n
    ).toBe(0);
    await db.query("UPDATE dealer_opportunities SET stage='won' WHERE id=$1", [
      o,
    ]);
    expect(await allowed('dealer_follow_up_due')).toBe(false);
  });
  it('only the trusted service role can enqueue or approve sends', async () => {
    await db.exec(`SET ROLE authenticated; SET app.uid='${user}';`);
    await expect(
      db.query('SELECT enqueue_dealer_automation_events()')
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('SELECT dealer_automation_allowed($1,$2,$3,$4::jsonb)', [
        ws,
        contact,
        'dealer_follow_up_due',
        '{}',
      ])
    ).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
  });
});
