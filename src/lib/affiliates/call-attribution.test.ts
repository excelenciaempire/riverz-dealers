import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('assigns a call referral once, rejects self-referrals/inactive partners, and restricts execution', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
      CREATE TABLE workspaces(id uuid PRIMARY KEY, owner_id uuid REFERENCES auth.users);
      INSERT INTO auth.users VALUES
        ('00000000-0000-0000-0000-000000000001','buyer@example.com'),
        ('00000000-0000-0000-0000-000000000002','partner@example.com');
      INSERT INTO workspaces VALUES
        ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002');
    `);
    await db.exec(
      readFileSync('supabase/migrations/286_affiliate_program.sql', 'utf8')
    );
    await db.exec(
      readFileSync(
        'supabase/migrations/289_affiliate_call_attribution.sql',
        'utf8'
      )
    );
    await db.exec(`INSERT INTO affiliate_partners(id,name,email,audience,promotion_plan,referral_code,status)
      VALUES ('00000000-0000-0000-0000-000000000005','Partner','partner@example.com','Stores','Introductions by email','ABCD1234','active')`);
    const assign = (workspace: string, note = 'Sales call reference') =>
      db.query('SELECT assign_affiliate_call_referral($1::uuid,$2::uuid,$3)', [
        '00000000-0000-0000-0000-000000000005',
        workspace,
        note,
      ]);
    await expect(
      assign('00000000-0000-0000-0000-000000000004')
    ).rejects.toThrow('invalid_referred_customer');
    await expect(
      assign('00000000-0000-0000-0000-000000000003', '')
    ).rejects.toThrow('invalid_call_note');
    await assign('00000000-0000-0000-0000-000000000003');
    await expect(
      assign('00000000-0000-0000-0000-000000000003')
    ).rejects.toThrow('duplicate key');
    const result = await db.query(
      'SELECT attribution_source, attribution_note FROM affiliate_referrals'
    );
    expect(result.rows).toEqual([
      { attribution_source: 'call', attribution_note: 'Sales call reference' },
    ]);
    await db.exec("UPDATE affiliate_partners SET status = 'paused'");
    await expect(
      assign('00000000-0000-0000-0000-000000000003')
    ).rejects.toThrow('affiliate_not_active');
    const permissions = await db.query(`SELECT
      has_function_privilege('anon','assign_affiliate_call_referral(uuid,uuid,text)','execute') AS anon,
      has_function_privilege('authenticated','assign_affiliate_call_referral(uuid,uuid,text)','execute') AS authenticated,
      has_function_privilege('service_role','assign_affiliate_call_referral(uuid,uuid,text)','execute') AS service`);
    expect(permissions.rows).toEqual([
      { anon: false, authenticated: false, service: true },
    ]);
  } finally {
    await db.close();
  }
}, 30000);
