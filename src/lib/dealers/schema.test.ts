import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dealerSettings } from './settings';
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
    CREATE TABLE workspace_members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES auth.users(id),role text DEFAULT 'admin');
    CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id),opted_out boolean DEFAULT false,user_id uuid,name text,email text,phone text DEFAULT '',created_at timestamptz DEFAULT now());
    CREATE TABLE conversations(id uuid PRIMARY KEY,workspace_id uuid,contact_id uuid);
    CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid,sender_type text,created_at timestamptz DEFAULT now(),status text DEFAULT 'delivered');
    CREATE FUNCTION is_workspace_member(p_workspace uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=auth.uid()) $$;
    INSERT INTO auth.users VALUES('${user}'); INSERT INTO workspaces(id,owner_id) VALUES('${ws}','${user}'),('${other}','${user}');
    INSERT INTO workspace_members VALUES('${ws}','${user}'); INSERT INTO contacts VALUES('${contact}','${ws}',false),('${foreign}','${other}',false);
    GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT,UPDATE ON contacts TO authenticated; GRANT SELECT ON workspace_members TO authenticated;`);
  await db.exec(readFileSync('supabase/migrations/375_dealers.sql', 'utf8'));
  await db.exec(`CREATE TABLE automations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,trigger_type text,is_active boolean DEFAULT false,deleted_at timestamptz);
    CREATE TABLE automation_event_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,automation_id uuid,contact_id uuid,
      event_type text CHECK(event_type IN ('tag_added','time_based')),event_key text,context jsonb,expires_at timestamptz,UNIQUE(automation_id,contact_id,event_key));`);
  await db.exec(
    readFileSync('supabase/migrations/376_dealer_automations.sql', 'utf8')
  );
  await db.exec(
    readFileSync('supabase/migrations/377_dealer_sales_execution.sql', 'utf8')
  );
  await db.exec(
    readFileSync(
      'supabase/migrations/378_dealer_unpublished_prices.sql',
      'utf8'
    )
  );
  await db.exec(readFileSync('supabase/migrations/379_dealer_growth.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/380_dealer_followup_settings.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/381_dealer_intake_consent.sql','utf8'));
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('dealer SQL invariants', () => {
  it('stores a missing published price as NULL while still rejecting negative prices', async () => {
    const v = await vehicle('UNPRICED');
    await db.query('UPDATE dealer_vehicles SET price=NULL WHERE id=$1', [v]);
    expect(
      (await db.query<{ price: number | null }>('SELECT price FROM dealer_vehicles WHERE id=$1', [v]))
        .rows[0].price
    ).toBeNull();
    await expect(
      db.query('UPDATE dealer_vehicles SET price=-1 WHERE id=$1', [v])
    ).rejects.toThrow();
  });
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

describe.sequential('seller activity and appointment execution', () => {
  const buyer = '40000000-0000-4000-8000-000000000003';
  let o: string, a: string;
  it('keeps buyer context and activity timestamps inside an atomic tenant save', async () => {
    await db.query('INSERT INTO contacts VALUES($1,$2,false)', [buyer, ws]);
    o = (
      await db.query<{ id: string }>(
        'SELECT id FROM dealer_opportunities WHERE contact_id=$1',
        [buyer]
      )
    ).rows[0].id;
    await db.exec(`SET ROLE authenticated; SET app.uid='${user}';`);
    await db.query('SELECT dealer_log_activity($1,$2,$3,$4,$5,$6)', [
      ws,
      o,
      'call_no_answer',
      'No answer',
      new Date(Date.now() + 3600000).toISOString(),
      'Send video',
    ]);
    expect(
      (
        await db.query<{ first_contact_at: string | null }>(
          'SELECT first_contact_at FROM dealer_opportunities WHERE id=$1',
          [o]
        )
      ).rows[0].first_contact_at
    ).toBeNull();
    await db.query('SELECT dealer_log_activity($1,$2,$3,$4,$5,$6)', [
      ws,
      o,
      'call_connected',
      'Needs family car',
      new Date(Date.now() + 7200000).toISOString(),
      'Discuss options',
    ]);
    expect(
      (
        await db.query<{ first_contact_at: string | null }>(
          'SELECT first_contact_at FROM dealer_opportunities WHERE id=$1',
          [o]
        )
      ).rows[0].first_contact_at
    ).not.toBeNull();
    await expect(
      db.query('SELECT dealer_log_activity($1,$2,$3,$4,$5,$6)', [
        other,
        o,
        'call_connected',
        '',
        null,
        '',
      ])
    ).rejects.toThrow('dealer_reference');
    await expect(
      db.query('UPDATE dealer_activities SET note=$1 WHERE opportunity_id=$2', [
        'forged',
        o,
      ])
    ).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
  });
  it('resets preparation after a reschedule and rejects a future no-show outcome', async () => {
    const v = await vehicle('EXECUTION');
    a = (await appointment(o, v, 36)).rows[0].id;
    await db.query(
      'UPDATE dealer_appointments SET customer_confirmed=true,vehicle_prepared=true,directions_sent=true WHERE id=$1',
      [a]
    );
    await expect(
      db.query("UPDATE dealer_appointments SET status='no_show' WHERE id=$1", [
        a,
      ])
    ).rejects.toThrow('dealer_past');
    await db.query(
      "UPDATE dealer_appointments SET starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' WHERE id=$1",
      [a]
    );
    expect(
      (
        await db.query(
          'SELECT customer_confirmed,vehicle_prepared,directions_sent FROM dealer_appointments WHERE id=$1',
          [a]
        )
      ).rows[0]
    ).toEqual({
      customer_confirmed: false,
      vehicle_prepared: false,
      directions_sent: false,
    });
  });
  it('enqueues one bounded missed-visit recovery and invalidates it after seller contact', async () => {
    // An already-ended recorded visit is distinct from a scheduled future visit.
    await db.query(
      "UPDATE dealer_appointments SET status='cancelled' WHERE id=$1",
      [a]
    );
    await db.query(
      "UPDATE dealer_appointments SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',status='no_show' WHERE id=$1",
      [a]
    );
    await db.query(
      'UPDATE dealer_opportunities SET follow_up_paused=false,last_contact_at=null WHERE id=$1',
      [o]
    );
    await db.query(
      "INSERT INTO automations(workspace_id,trigger_type,is_active) VALUES($1,'dealer_no_show',true)",
      [ws]
    );
    await db.query('SELECT enqueue_dealer_automation_events()');
    const jobs = (
      await db.query<{ context: { vars: Record<string, unknown> } }>(
        "SELECT context FROM automation_event_jobs WHERE event_type='dealer_no_show' AND contact_id=$1",
        [buyer]
      )
    ).rows;
    expect(jobs).toHaveLength(1);
    const allowed = () =>
      db.query<{ ok: boolean }>(
        'SELECT dealer_automation_allowed($1,$2,$3,$4::jsonb) AS ok',
        [ws, buyer, 'dealer_no_show', JSON.stringify(jobs[0].context.vars)]
      );
    expect((await allowed()).rows[0].ok).toBe(true);
    const cv = '50000000-0000-4000-8000-000000000003',
      msg = '60000000-0000-4000-8000-000000000003';
    await db.query('INSERT INTO conversations VALUES($1,$2,$3)', [
      cv,
      ws,
      buyer,
    ]);
    await db.query(
      "INSERT INTO messages(id,conversation_id,sender_type) VALUES($1,$2,'customer')",
      [msg, cv]
    );
    expect((await allowed()).rows[0].ok).toBe(false);
    await db.query('DELETE FROM messages WHERE id=$1', [msg]);
    await db.query('SELECT enqueue_dealer_automation_events()');
    expect(
      (
        await db.query(
          "SELECT id FROM automation_event_jobs WHERE event_type='dealer_no_show' AND contact_id=$1",
          [buyer]
        )
      ).rows
    ).toHaveLength(1);
    await db.query(
      'UPDATE dealer_opportunities SET last_contact_at=now() WHERE id=$1',
      [o]
    );
    expect((await allowed()).rows[0].ok).toBe(false);
    await db.query("UPDATE dealer_opportunities SET stage='lost' WHERE id=$1", [
      o,
    ]);
  });
});

describe.sequential('dealer growth SQL boundaries',()=>{
 it('confirms and reschedules links atomically, checks conflicts and invalidates stale links',async()=>{
  const config=dealerSettings({appointments:{start_hour:0,end_hour:24,weekdays:[0,1,2,3,4,5,6],notice_hours:0}});
  await db.query('INSERT INTO dealer_settings(workspace_id,settings) VALUES($1,$2::jsonb)',[ws,JSON.stringify(config)]);
  const buyer=(await db.query<{id:string}>('INSERT INTO contacts(workspace_id) VALUES($1) RETURNING id',[ws])).rows[0].id;
  const opportunityId=(await db.query<{id:string}>('SELECT id FROM dealer_opportunities WHERE contact_id=$1',[buyer])).rows[0].id;
  const v=await vehicle('LINK-TEST'),id=(await appointment(opportunityId,v,100)).rows[0].id;
  const ap=(await db.query<{starts_at:Date}>('SELECT starts_at FROM dealer_appointments WHERE id=$1',[id])).rows[0];
  await db.query("INSERT INTO dealer_appointment_links(token_hash,workspace_id,appointment_id,expires_at,schedule_revision) VALUES('test-link',$1,$2,now()+interval '7 days',$3)",[ws,id,ap.starts_at]);
  await db.query("SELECT dealer_appointment_action('test-link','confirm')");expect((await db.query<{customer_confirmed:boolean}>('SELECT customer_confirmed FROM dealer_appointments WHERE id=$1',[id])).rows[0].customer_confirmed).toBe(true);
  await appointment(opportunityId,await vehicle('LINK-CONFLICT'),101);
  await expect(db.query("SELECT dealer_appointment_action('test-link','reschedule',now()+interval '101 hours',now()+interval '101 hours 30 minutes')")).rejects.toThrow('dealer_conflict');
  expect((await db.query<{starts_at:Date}>('SELECT starts_at FROM dealer_appointments WHERE id=$1',[id])).rows[0].starts_at).toEqual(ap.starts_at);
  await db.query("SELECT dealer_appointment_action('test-link','reschedule',now()+interval '102 hours',now()+interval '102 hours 30 minutes')");
  expect((await db.query<{status:string;customer_confirmed:boolean}>('SELECT status,customer_confirmed FROM dealer_appointments WHERE id=$1',[id])).rows[0]).toEqual({status:'requested',customer_confirmed:false});
  await db.query("UPDATE dealer_appointments SET starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' WHERE id=$1",[id]);
  await expect(db.query("SELECT dealer_appointment_action('test-link','confirm')")).rejects.toThrow('dealer_closed');
  await db.query('DELETE FROM dealer_settings WHERE workspace_id=$1',[ws]);
 });
 it('records response only after an actual send and connection only after a customer reply',async()=>{
  const buyer=(await db.query<{id:string}>('INSERT INTO contacts(workspace_id) VALUES($1) RETURNING id',[ws])).rows[0].id;
  const id=(await db.query<{id:string}>('SELECT id FROM dealer_opportunities WHERE contact_id=$1',[buyer])).rows[0].id;
  const conv=(await db.query<{id:string}>('INSERT INTO conversations(id,workspace_id,contact_id) VALUES(gen_random_uuid(),$1,$2) RETURNING id',[ws,buyer])).rows[0].id;
  const msg=(await db.query<{id:string}>("INSERT INTO messages(id,conversation_id,sender_type,status) VALUES(gen_random_uuid(),$1,'agent','pending') RETURNING id",[conv])).rows[0].id;
  expect((await db.query<{first_response_at:Date|null}>('SELECT first_response_at FROM dealer_opportunities WHERE id=$1',[id])).rows[0].first_response_at).toBeNull();
  await db.query("UPDATE messages SET status='sent' WHERE id=$1",[msg]);
  const sent=(await db.query<{first_response_at:Date|null;first_contact_at:Date|null}>('SELECT first_response_at,first_contact_at FROM dealer_opportunities WHERE id=$1',[id])).rows[0];expect(sent.first_response_at).not.toBeNull();expect(sent.first_contact_at).toBeNull();
  await db.query("INSERT INTO messages(id,conversation_id,sender_type) VALUES(gen_random_uuid(),$1,'customer')",[conv]);
  expect((await db.query<{first_contact_at:Date|null}>('SELECT first_contact_at FROM dealer_opportunities WHERE id=$1',[id])).rows[0].first_contact_at).not.toBeNull();
  await db.query("UPDATE dealer_opportunities SET stage='qualified' WHERE id=$1",[id]);
  expect((await db.query<{to_stage:string}>('SELECT to_stage FROM dealer_stage_history WHERE opportunity_id=$1 ORDER BY changed_at',[id])).rows.map(r=>r.to_stage)).toEqual(['inquiry','qualified']);
  await db.query('DELETE FROM contacts WHERE id=$1',[buyer]);
 });
 it('allows manager settings with a version check and rejects a foreign seller',async()=>{
  await db.query("SELECT set_config('app.uid',$1,false)",[user]);
  const settings=dealerSettings({follow_up:{start_hour:0,end_hour:24,weekdays:[0,1,2,3,4,5,6]}});
  const saved=await db.query<{v:number}>('SELECT dealer_save_settings($1,0,$2::jsonb) AS v',[ws,JSON.stringify(settings)]);expect(saved.rows[0].v).toBe(1);
  await expect(db.query('SELECT dealer_save_settings($1,0,$2::jsonb)',[ws,JSON.stringify(settings)])).rejects.toThrow('dealer_conflict');
  settings.leads.default_seller_id='30000000-0000-4000-8000-000000000099';
  await expect(db.query('SELECT dealer_save_settings($1,1,$2::jsonb)',[ws,JSON.stringify(settings)])).rejects.toThrow('dealer_reference');
 });
 it('ingests idempotently, assigns a seller and never reverses opt-out',async()=>{
  await db.query("UPDATE dealer_settings SET settings=jsonb_set(settings,'{leads,webhook_enabled}','true') WHERE workspace_id=$1",[ws]);
  const lead={external_id:'meta-1',source:'meta',phone:'+13055550199',name:'Demo buyer',email:'',preferences:'Toyota Camry',consent:true,consent_at:new Date().toISOString()};
  const unconsented=(await db.query<{v:{opportunity_id:string}}>('SELECT dealer_ingest_lead($1,$2::jsonb) AS v',[ws,JSON.stringify({...lead,external_id:'without-consent',phone:'+13055550198',consent:false,consent_at:null})])).rows[0].v;
  expect((await db.query<{follow_up_paused:boolean;next_follow_up_at:Date|null}>('SELECT follow_up_paused,next_follow_up_at FROM dealer_opportunities WHERE id=$1',[unconsented.opportunity_id])).rows[0]).toEqual({follow_up_paused:true,next_follow_up_at:null});
  const first=(await db.query<{v:{contact_id:string;opportunity_id:string;duplicate:boolean}}>('SELECT dealer_ingest_lead($1,$2::jsonb) AS v',[ws,JSON.stringify(lead)])).rows[0].v;
  const repeat=(await db.query<{v:{duplicate:boolean}}>('SELECT dealer_ingest_lead($1,$2::jsonb) AS v',[ws,JSON.stringify(lead)])).rows[0].v;expect(repeat.duplicate).toBe(true);
  expect((await db.query<{assigned_seller_id:string}>('SELECT assigned_seller_id FROM dealer_opportunities WHERE id=$1',[first.opportunity_id])).rows[0].assigned_seller_id).toBe(user);
  await db.query('UPDATE contacts SET opted_out=true WHERE id=$1',[first.contact_id]);
  await db.query('SELECT dealer_ingest_lead($1,$2::jsonb)',[ws,JSON.stringify({...lead,external_id:'meta-2'})]);
  expect((await db.query<{opted_out:boolean}>('SELECT opted_out FROM contacts WHERE id=$1',[first.contact_id])).rows[0].opted_out).toBe(true);
  await db.query("DELETE FROM dealer_settings WHERE workspace_id=$1",[ws]);
 });
 it('keeps credentials private and prevents authenticated intake, import and link actions',async()=>{
  await db.exec('SET ROLE authenticated');
  try {
   await expect(db.query('SELECT * FROM dealer_credentials')).rejects.toThrow('permission denied');
   await expect(db.query("SELECT dealer_ingest_lead($1,'{}'::jsonb)",[ws])).rejects.toThrow('permission denied');
   await expect(db.query("SELECT dealer_appointment_action('x','confirm')")).rejects.toThrow('permission denied');
  }finally{await db.exec('RESET ROLE');}
 });
 it('imports atomically and never reopens a seller-reserved unit by default',async()=>{
  const id=await vehicle('GROWTH-IMPORT');await db.query("UPDATE dealer_vehicles SET status='reserved' WHERE id=$1",[id]);
  const row={stock_number:'GROWTH-IMPORT',vin:null,make:'Toyota',model:'Camry',year:2026,mileage:0,mileage_unit:'mi',price:25000,currency:'USD',status:'available',photos:[],notes:''};
  const run=(await db.query<{id:string}>("INSERT INTO dealer_sync_runs(workspace_id,source,status) VALUES($1,'test','running') RETURNING id",[ws])).rows[0].id;
  await expect(db.query('SELECT dealer_import_inventory($1,$2,$3::jsonb,$4,false,false,1)',[ws,run,JSON.stringify([row,{...row,stock_number:'GROWTH-BAD',vin:'invalid'}]),'test'])).rejects.toThrow();
  expect((await db.query<{price:number}>('SELECT price FROM dealer_vehicles WHERE id=$1',[id])).rows[0].price).toBe('23000.00');
  await db.query('SELECT dealer_import_inventory($1,$2,$3::jsonb,$4,false,false,1)',[ws,run,JSON.stringify([row]),'test']);
  expect((await db.query<{status:string}>('SELECT status FROM dealer_vehicles WHERE id=$1',[id])).rows[0].status).toBe('reserved');
 });
});
