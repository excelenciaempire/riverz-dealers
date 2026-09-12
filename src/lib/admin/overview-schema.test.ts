import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('optimized overview preserves every aggregate and service-role-only execution', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE workspaces(created_at timestamptz, deleted_at timestamptz);
      CREATE TABLE workspace_members(user_id text);
      CREATE TABLE contacts(id int);
      CREATE TABLE conversations(created_at timestamptz, deleted_at timestamptz);
      CREATE TABLE messages(created_at timestamptz, sender_type text, status text);
      CREATE TABLE ai_replies(created_at timestamptz, status text, prompt_tokens int, completion_tokens int);
      CREATE TABLE voice_calls(created_at timestamptz, cost jsonb);
      CREATE TABLE orders(created_at timestamptz);
      CREATE TABLE channel_connections(status text);
      CREATE TABLE webhook_events_raw(processed_at timestamptz);
      CREATE TABLE cron_runs(name text NOT NULL, started_at timestamptz NOT NULL, status text, finished_at timestamptz, duration_ms int, error text);
      INSERT INTO workspaces VALUES ('2026-09-06',NULL), ('2026-08-01','2026-09-07');
      INSERT INTO workspace_members VALUES ('a'),('a'),('b');
      INSERT INTO contacts VALUES (1),(2);
      INSERT INTO conversations VALUES ('2026-09-06',NULL),('2026-09-06','2026-09-07'),('2026-08-01',NULL);
      INSERT INTO messages VALUES ('2026-09-05','customer','received'),('2026-09-06','bot','failed'),('2026-09-12','agent','sent');
      INSERT INTO ai_replies VALUES ('2026-09-06','sent',10,20),('2026-09-06','failed',NULL,NULL),('2026-09-06','skipped',5,0);
      INSERT INTO voice_calls VALUES ('2026-09-06','{"minutes":"3.5","total_usd":"0.25"}'),('2026-09-06','{"minutes":"invalid","total_usd":null}');
      INSERT INTO orders VALUES ('2026-09-06');
      INSERT INTO channel_connections VALUES ('connected'),('expired'),('error');
      INSERT INTO webhook_events_raw VALUES (NULL),('2026-09-06');
      INSERT INTO cron_runs(name,started_at,status) VALUES ('a','2026-09-06','error'),('a','2026-09-07','ok'),('b','2026-09-06','error'),('c',now(),'ok'),('c',now()-interval '1 hour','error');
    `);
    const original = readFileSync('supabase/migrations/125_admin_platform_rpcs.sql', 'utf8');
    const extract = (name: string) => {
      const start = original.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
      return original.slice(start, original.indexOf('$$;', original.indexOf('AS $$', start)) + 3);
    };
    await db.exec(extract('admin_num'));
    await db.exec(extract('admin_platform_overview'));
    await db.exec(extract('admin_cron_health'));
    const query = "SELECT * FROM admin_platform_overview('2026-09-05','2026-09-12')";
    const before = await db.query(query);
    const cronBefore = await db.query('SELECT * FROM admin_cron_health()');
    const migration = readFileSync('supabase/migrations/258_admin_overview_single_pass.sql', 'utf8');
    await db.exec(migration);
    expect((await db.query(query)).rows).toEqual(before.rows);
    expect((await db.query('SELECT * FROM admin_cron_health()')).rows).toEqual(cronBefore.rows);
    expect((await db.query(query)).rows[0]).toMatchObject({ messages_in: 1, messages_out: 1, calls_minutes: '3.5', crons_error: 1 });
    await db.exec(migration);
    expect((await db.query(query)).rows).toEqual(before.rows);
    const permissions = await db.query(`SELECT
      has_function_privilege('anon','admin_platform_overview(timestamptz,timestamptz)','EXECUTE') AS anon,
      has_function_privilege('authenticated','admin_platform_overview(timestamptz,timestamptz)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','admin_platform_overview(timestamptz,timestamptz)','EXECUTE') AS service_role`);
    expect(permissions.rows).toEqual([{ anon: false, authenticated: false, service_role: true }]);
    await db.exec('TRUNCATE cron_runs');
    expect((await db.query('SELECT * FROM admin_latest_cron_runs()')).rows).toEqual([]);
    expect((await db.query(query)).rows[0]).toMatchObject({ crons_error: 0 });
  } finally {
    await db.close();
  }
}, 15_000);
