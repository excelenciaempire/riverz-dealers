import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('totals every wallet atomically, separates currencies and blocks browser roles', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE wallet_accounts (moneda text, saldo_centavos bigint, reservado_centavos bigint, resto_costo_centavos numeric);
      CREATE TABLE wallet_operaciones (proveedor text, costo_centavos numeric, estado text, created_at timestamptz);
      GRANT SELECT ON wallet_accounts,wallet_operaciones TO service_role;
      INSERT INTO wallet_accounts SELECT 'usd',100,10,0.5 FROM generate_series(1,1501);
      INSERT INTO wallet_accounts VALUES ('eur',300,20,0);
      INSERT INTO wallet_operaciones VALUES ('anthropic',0.25,'liquidada',now()),('anthropic',100,'cancelada',now()),('fish',999,'liquidada',now()-interval '8 days');`);
    const migration = readFileSync(
      'supabase/migrations/301_admin_funding.sql',
      'utf8'
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(
      "INSERT INTO platform_provider_balances VALUES ('anthropic',20,'digest',now()-interval '1 hour','admin')"
    );
    const billingMigration = readFileSync(
      'supabase/migrations/302_provider_billing_mode.sql',
      'utf8'
    );
    await db.exec(billingMigration);
    await db.exec(billingMigration);
    await db.exec(
      "INSERT INTO platform_provider_balances (provider,balance_usd,key_digest,updated_by,billing_mode) VALUES ('groq',0,'digest','admin','postpaid'); SET ROLE service_role"
    );
    const result = (
      await db.query<{
        snapshot: {
          wallets: Array<Record<string, unknown>>;
          usage: unknown[];
          manual: Array<Record<string, unknown>>;
        };
      }>('SELECT admin_funding_snapshot() AS snapshot')
    ).rows[0].snapshot;
    expect(result.wallets.find((w) => w.currency === 'USD')).toMatchObject({
      accounts: 1501,
      balance_cents: 150100,
      available_cents: 134339.5,
    });
    expect(result.wallets.find((w) => w.currency === 'EUR')).toMatchObject({
      balance_cents: 300,
    });
    expect(result.usage).toEqual([{ provider: 'anthropic', usd_week: 0.0025 }]);
    expect(result.manual.find((m) => m.provider === 'anthropic')).toMatchObject(
      {
        balance_usd: 20,
        billing_mode: 'prepaid',
        spent_since_usd: 0.0025,
      }
    );
    expect(result.manual.find((m) => m.provider === 'groq')?.billing_mode).toBe(
      'postpaid'
    );
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await expect(db.query('SELECT admin_funding_snapshot()')).rejects.toThrow(
        /permission denied/
      );
      await expect(
        db.query('SELECT * FROM platform_provider_balances')
      ).rejects.toThrow(/permission denied/);
    }
  } finally {
    await db.close();
  }
}, 20_000);
