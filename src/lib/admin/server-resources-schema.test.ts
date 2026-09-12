import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('blocks browser roles from server-only records and privileged RPCs while preserving service access', async () => {
  const db = new PGlite();
  const tables = ['operator_plans','operator_plan_steps','operator_agent_usage','operator_runs','billing_plans','workspace_subscriptions','billing_usage_daily','support_access'];
  const functions = ['wallet_mover','wallet_acumular','claim_voice_call_with_capacity','_bcast_bump','recompute_broadcast_counts','get_waba_24h_sent_count'];
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const table of tables) {
      await db.exec(`CREATE TABLE ${table}(id int); INSERT INTO ${table} VALUES (1); GRANT ALL ON ${table} TO anon, authenticated, service_role;`);
    }
    for (const fn of functions) {
      await db.exec(`CREATE FUNCTION ${fn}() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;`);
    }
    const migration = readFileSync('supabase/migrations/259_private_server_resources.sql','utf8');
    await db.exec(migration);
    await db.exec(migration);
    for (const table of tables) {
      const { rows } = await db.query(`SELECT relrowsecurity AS rls,
        has_table_privilege('anon',oid,'SELECT') AS anon,
        has_table_privilege('authenticated',oid,'UPDATE') AS authenticated,
        has_table_privilege('service_role',oid,'SELECT') AS service FROM pg_class WHERE relname=$1`, [table]);
      expect(rows).toEqual([{ rls: true, anon: false, authenticated: false, service: true }]);
    }
    for (const fn of functions) {
      const { rows } = await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
        has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
        has_function_privilege('service_role',$1,'EXECUTE') AS service`, [`${fn}()`]);
      expect(rows).toEqual([{ anon: false, authenticated: false, service: true }]);
    }
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM operator_plans')).rejects.toThrow(/permission denied/);
    await expect(db.query('SELECT wallet_mover()')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role');
    expect((await db.query('SELECT * FROM operator_plans')).rows).toEqual([{id:1}]);
  } finally { await db.close(); }
}, 15_000);
