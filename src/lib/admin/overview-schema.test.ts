import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('optimized overview preserves every aggregate and service-role-only execution', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE workspaces(id uuid, name text, owner_id text, created_at timestamptz, deleted_at timestamptz);
      CREATE TABLE workspace_members(user_id text);
      CREATE TABLE profiles(user_id text, email text);
      CREATE TABLE contacts(id int, created_at timestamptz);
      CREATE TABLE conversations(id uuid, workspace_id uuid, created_at timestamptz, deleted_at timestamptz);
      CREATE TABLE messages(conversation_id uuid, created_at timestamptz, sender_type text, status text);
      CREATE TABLE ai_agents(id uuid, model text);
      CREATE TABLE ai_replies(workspace_id uuid, agent_id uuid, key_source text, created_at timestamptz, status text, prompt_tokens int, completion_tokens int);
      CREATE TABLE voice_calls(workspace_id uuid, created_at timestamptz, cost jsonb);
      CREATE TABLE orders(workspace_id uuid, created_at timestamptz);
      CREATE TABLE channel_connections(status text);
      CREATE TABLE webhook_events_raw(processed_at timestamptz);
      CREATE TABLE cron_runs(name text NOT NULL, started_at timestamptz NOT NULL, status text, finished_at timestamptz, duration_ms int, error text);
      INSERT INTO workspaces VALUES
        ('00000000-0000-0000-0000-000000000001','One','owner-1','2026-09-06',NULL),
        ('00000000-0000-0000-0000-000000000002','Two','owner-2','2026-08-01','2026-09-07');
      INSERT INTO workspace_members VALUES ('a'),('a'),('b');
      INSERT INTO profiles VALUES ('owner-1','one@example.test'),('owner-2','two@example.test');
      INSERT INTO contacts VALUES (1,'2026-09-05'),(2,'2026-08-01');
      INSERT INTO conversations VALUES
        ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','2026-09-06',NULL),
        ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','2026-09-06','2026-09-07'),
        ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','2026-08-01',NULL);
      INSERT INTO messages VALUES
        ('10000000-0000-0000-0000-000000000001','2026-09-05','customer','received'),
        ('10000000-0000-0000-0000-000000000001','2026-09-06','bot','failed'),
        ('10000000-0000-0000-0000-000000000001','2026-09-06','agent','sent'),
        ('10000000-0000-0000-0000-000000000001','2026-09-07','bot','sending'),
        ('10000000-0000-0000-0000-000000000001','2026-09-08','bot','delivered');
      INSERT INTO ai_agents VALUES ('20000000-0000-0000-0000-000000000001','model');
      INSERT INTO ai_replies VALUES
        ('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','platform','2026-09-06','sent',10,20),
        ('00000000-0000-0000-0000-000000000001',NULL,'platform','2026-09-06','failed',NULL,NULL),
        ('00000000-0000-0000-0000-000000000001',NULL,'platform','2026-09-06','skipped',5,0);
      INSERT INTO voice_calls VALUES
        ('00000000-0000-0000-0000-000000000001','2026-09-06','{"minutes":"3.5","total_usd":"0.25"}'),
        ('00000000-0000-0000-0000-000000000001','2026-09-06','{"minutes":"invalid","total_usd":null}');
      INSERT INTO orders VALUES ('00000000-0000-0000-0000-000000000001','2026-09-06');
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
    await db.exec(extract('admin_activity_series'));
    await db.exec(extract('admin_cron_health'));
    const query = "SELECT * FROM admin_platform_overview('2026-09-05','2026-09-12')";
    const before = await db.query(query);
    const cronBefore = await db.query('SELECT * FROM admin_cron_health()');
    const migration = readFileSync('supabase/migrations/258_admin_overview_single_pass.sql', 'utf8');
    await db.exec(migration);
    expect((await db.query(query)).rows).toEqual(before.rows);
    expect((await db.query('SELECT * FROM admin_cron_health()')).rows).toEqual(cronBefore.rows);
    const accuracy = readFileSync('supabase/migrations/293_admin_metric_status_accuracy.sql', 'utf8');
    await db.exec(accuracy);
    expect((await db.query(query)).rows[0]).toMatchObject({
      messages_in: 1,
      messages_out: 2,
      messages_failed: 1,
      ai_sent: 1,
      ai_skipped: 1,
      ai_failed: 1,
      calls_minutes: '3.5',
      crons_error: 1,
    });
    const series = await db.query(
      "SELECT sum(messages_out) AS messages_out, sum(ai_replies) AS ai_replies FROM admin_activity_series('2026-09-05','2026-09-12')",
    );
    expect(series.rows).toEqual([{ messages_out: '2', ai_replies: '1' }]);
    const usage = await db.query(
      "SELECT messages_out, ai_sent, ai_skipped, ai_failed FROM admin_usage_rows('2026-09-05','2026-09-12') WHERE workspace_id = '00000000-0000-0000-0000-000000000001'",
    );
    expect(usage.rows).toEqual([{
      messages_out: 2,
      ai_sent: 1,
      ai_skipped: 1,
      ai_failed: 1,
    }]);
    await db.exec(accuracy);
    expect((await db.query(query)).rows[0]).toMatchObject({ messages_out: 2, ai_sent: 1 });
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
