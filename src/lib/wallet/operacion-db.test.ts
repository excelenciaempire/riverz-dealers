import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const ws = '00000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_subscriptions(workspace_id uuid,estado text);
    CREATE TABLE wallet_accounts(workspace_id uuid PRIMARY KEY REFERENCES workspaces, saldo_centavos bigint DEFAULT 0,
      bloquear_sin_saldo boolean DEFAULT false, descubierto_centavos int DEFAULT 200,cobrar_a_costo boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE wallet_movimientos(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,tipo text,concepto text,centavos bigint,saldo_despues_centavos bigint,
      costo_centavos numeric,cantidad numeric,referencia_tipo text,referencia_id text,detalle jsonb);
    INSERT INTO workspaces VALUES('${ws}'); INSERT INTO wallet_accounts(workspace_id,saldo_centavos) VALUES('${ws}',100);`);
  await db.exec(
    readFileSync('supabase/migrations/253_wallet_provider_usage.sql', 'utf8')
  );
}, 20000);
afterAll(async () => db.close());
const reserve = (id: string, cents: number) =>
  db.query<{ ok: boolean }>(
    "select wallet_reservar($1,$2,'ia_respuesta','anthropic',$3) as ok",
    [ws, id, cents]
  );
const settle = (id: string, cents: number) =>
  db.query(
    "select * from wallet_liquidar($1,$2,'ia_respuesta','anthropic',$3)",
    [ws, id, cents]
  );
describe('atomic provider accounting in PostgreSQL', () => {
  it('reserves a global balance only once across concurrent requests', async () => {
    const results = await Promise.all([reserve('a', 60), reserve('b', 60)]);
    expect(results.map((r) => r.rows[0].ok)).toEqual([true, false]);
  });
  it('settles exact usage, releases excess and does not charge retries', async () => {
    await settle('a', 12.3);
    await settle('a', 12.3);
    const { rows } = await db.query<{
      saldo_centavos: number;
      reservado_centavos: number;
      resto_costo_centavos: string;
    }>('select * from wallet_accounts');
    expect(Number(rows[0].saldo_centavos)).toBe(88);
    expect(Number(rows[0].reservado_centavos)).toBe(0);
    expect(Number(rows[0].resto_costo_centavos)).toBeCloseTo(0.3);
  });
  it('preserves fractional costs across different operations', async () => {
    await settle('fraction', 0.8);
    const { rows } = await db.query<{
      saldo_centavos: number;
      resto_costo_centavos: string;
    }>('select * from wallet_accounts');
    expect(Number(rows[0].saldo_centavos)).toBe(87);
    expect(Number(rows[0].resto_costo_centavos)).toBeCloseTo(0.1);
  });
  it('rolls back every balance change when ledger insertion fails', async () => {
    await reserve('rollback', 10);
    await db.exec(
      "ALTER TABLE wallet_movimientos ADD CONSTRAINT injected_failure CHECK(referencia_id <> 'rollback')"
    );
    await expect(settle('rollback', 5)).rejects.toThrow();
    const { rows } = await db.query<{ estado: string }>(
      "select estado from wallet_operaciones where id='rollback'"
    );
    expect(rows[0].estado).toBe('reservada');
    await db.exec(
      'ALTER TABLE wallet_movimientos DROP CONSTRAINT injected_failure'
    );
    await settle('rollback', 5);
  });
  it('does not release another workspace reservation', async () => {
    await reserve('held', 10);
    await db.query('select wallet_cancelar_reserva($1,$2)', [
      '00000000-0000-4000-8000-000000000002',
      'held',
    ]);
    const { rows } = await db.query<{ estado: string }>(
      "select estado from wallet_operaciones where id='held'"
    );
    expect(rows[0].estado).toBe('reservada');
  });
  it('rejects an invalid actual cost without creating an operation', async () => {
    await expect(settle('bad', -1)).rejects.toThrow('wallet_invalid_cost');
  });
});

describe('receipt reconciliation and automatic top-ups', () => {
  it('adjusts actual usage up and down, with idempotent immutable receipts', async () => {
    await settle('receipt', 5);
    const reconcile = (receipt: string, cost: number) =>
      db.query('select wallet_conciliar_recibo($1,$2,$3)', [
        receipt,
        'receipt',
        cost,
      ]);
    await reconcile('actual-1', 7);
    await reconcile('actual-1', 7);
    await expect(reconcile('actual-1', 8)).rejects.toThrow(
      'wallet_receipt_conflict'
    );
    await reconcile('actual-2', 3);
    const { rows } = await db.query<{ cost: string }>(
      "select sum(costo_centavos) as cost from wallet_movimientos where referencia_id in ('receipt','actual-1','actual-2')"
    );
    expect(Number(rows[0].cost)).toBe(3);
  });
  it('claims a single immutable automatic payment across concurrent workers', async () => {
    const claim = () =>
      db.query<{ id: string; amount: number }>(
        "select * from wallet_auto_reclamar($1,'cus','pm',1000,10000)",
        [ws]
      );
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.rows[0].id).toBe(b.rows[0].id);
    const changed = await db.query<{ id: string; amount: number }>(
      "select * from wallet_auto_reclamar($1,'changed','changed',2000,10000)",
      [ws]
    );
    expect(changed.rows[0].id).toBe(a.rows[0].id);
    expect(Number(changed.rows[0].amount)).toBe(1000);
  });
  it('charges once when 100 workers retry the same operation and leaves other accounts untouched', async () => {
    const target = '00000000-0000-4000-8000-000000000003';
    await db.query('insert into workspaces values ($1)', [target]);
    await db.query('insert into wallet_accounts(workspace_id,saldo_centavos) values ($1,1000)', [target]);
    const before = await db.query('select saldo_centavos,reservado_centavos from wallet_accounts where workspace_id=$1', [ws]);
    const reservations = await Promise.allSettled(Array.from({ length: 100 }, () => db.query<{ ok: boolean }>(
      "select wallet_reservar($1,'burst-operation','ia_respuesta','anthropic',100) as ok", [target],
    )));
    expect(reservations.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of reservations) {
      if (result.status === 'fulfilled') expect(result.value.rows[0].ok).toBe(true);
      else expect(result.reason.message).toBe('wallet_operation_already_started');
    }
    await Promise.all(Array.from({ length: 100 }, () => db.query(
      "select * from wallet_liquidar($1,'burst-operation','ia_respuesta','anthropic',25)", [target],
    )));
    const account = await db.query<{ saldo_centavos: number; reservado_centavos: number }>(
      'select saldo_centavos,reservado_centavos from wallet_accounts where workspace_id=$1', [target],
    );
    expect(Number(account.rows[0].saldo_centavos)).toBe(975);
    expect(Number(account.rows[0].reservado_centavos)).toBe(0);
    const ledger = await db.query<{ count: number }>(
      "select count(*) from wallet_movimientos where referencia_id='burst-operation'",
    );
    expect(Number(ledger.rows[0].count)).toBe(1);
    const after = await db.query('select saldo_centavos,reservado_centavos from wallet_accounts where workspace_id=$1', [ws]);
    expect(after.rows).toEqual(before.rows);
  });
});
