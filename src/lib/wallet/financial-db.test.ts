import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const ws = '00000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY, deleted_at timestamptz);
    CREATE TABLE billing_plans(id uuid PRIMARY KEY, activo boolean, orden int);
    CREATE TABLE workspace_subscriptions(
      workspace_id uuid PRIMARY KEY,
      plan_id uuid,
      estado text,
      precio_centavos_override int,
      nota text
    );
    CREATE TABLE wallet_accounts(workspace_id uuid PRIMARY KEY REFERENCES workspaces, saldo_centavos bigint DEFAULT 0,
      bloquear_sin_saldo boolean DEFAULT false, descubierto_centavos int DEFAULT 200,cobrar_a_costo boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE wallet_movimientos(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,tipo text,concepto text,centavos bigint,saldo_despues_centavos bigint,
      costo_centavos numeric,cantidad numeric,referencia_tipo text,referencia_id text,detalle jsonb,stripe_id text,creado_en timestamptz DEFAULT now());
    INSERT INTO billing_plans VALUES('00000000-0000-4000-8000-000000000099',true,1);
    INSERT INTO workspaces(id) VALUES('${ws}');
    INSERT INTO workspace_subscriptions(workspace_id,estado) VALUES('${ws}','activa');
    INSERT INTO wallet_accounts(workspace_id,saldo_centavos) VALUES('${ws}',100);`);
  await db.exec(
    readFileSync('supabase/migrations/253_wallet_provider_usage.sql', 'utf8')
  );
  await db.exec(
    readFileSync('supabase/migrations/263_modelo_cobro_oficial.sql', 'utf8')
  );
  await db.exec(readFileSync('supabase/migrations/294_wallet_financial_costs.sql','utf8'));
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

const scalar = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0].n);
const fee = (id: string, cents: number, kind = 'processing', funding = 'pi_new', basis = 1000) => db.query(
  'select wallet_financial_import($1,$2,$3,coalesce((select occurred_at from wallet_financial_receipts where id=$1),now()),$4::jsonb,$5::jsonb)',
  [id, kind, cents, '{}', JSON.stringify([{ fundingId: funding, workspaceId: ws, allocatedCents: cents, basisCents: basis }])],
);
describe('receipt-backed integrated financial costs', () => {
  it('defaults off and preserves current operations', async () => {
    await reserve('old', 10);
    await settle('disabled', 1);
    expect(await scalar('select sum(amount_centavos) n from wallet_financial_recoveries')).toBe(0);
    await db.exec(`UPDATE wallet_financial_config SET enabled=true,activated_at=now();
      INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,stripe_id,creado_en)
      VALUES('${ws}','recarga','recarga',1000,'pi_new',now());
      UPDATE wallet_accounts SET saldo_centavos=10000 WHERE workspace_id='${ws}';`);
    await fee('processing', 59);
    await fee('instant', 50, 'instant_payout', 'pi_new', 2000);
    await settle('old', 10);
    expect(await scalar("select count(*) n from wallet_financial_recoveries where operation_id='old'")).toBe(0);
  });
  it('reserves the total, folds fees into usage, and retains the exact provider cost', async () => {
    await reserve('new', 100);
    expect(await scalar("select reserva_centavos n from wallet_operaciones where id='new'")).toBe(108);
    await settle('new', 100);
    expect(await scalar("select costo_centavos n from wallet_operaciones where id='new'")).toBe(100);
    expect(await scalar("select sum(amount_centavos) n from wallet_financial_recoveries where operation_id='new'")).toBe(7.5);
    expect(await scalar("select -centavos n from wallet_movimientos where referencia_id='new'")).toBe(107);
  });
  it('does not charge concurrent retries twice', async () => {
    await Promise.all(Array.from({length: 20}, () => settle('new',100)));
    await fee('processing', 59);
    expect(await scalar("select sum(amount_centavos) n from wallet_financial_recoveries where operation_id='new'")).toBe(7.5);
    expect(await scalar('select count(*) n from wallet_financial_receipts')).toBe(2);
    await expect(fee('processing', 60)).rejects.toThrow('wallet_financial_receipt_conflict');
  });
  it('corrects provider costs and financial recovery atomically, including after disabling', async () => {
    await db.query('select wallet_conciliar_recibo($1,$2,$3)', ['correction','new',50]);
    expect(await scalar("select sum(amount_centavos) n from wallet_financial_recoveries where operation_id='new'")).toBe(3.75);
    await db.exec('UPDATE wallet_financial_config SET enabled=false');
    await db.query('select wallet_conciliar_recibo($1,$2,$3)', ['full-refund','new',0]);
    expect(await scalar("select sum(amount_centavos) n from wallet_financial_recoveries where operation_id='new'")).toBe(0);
    await db.exec('UPDATE wallet_financial_config SET enabled=true');
  });
  it('rolls back fee recovery with a failed ledger write', async () => {
    await db.exec("ALTER TABLE wallet_movimientos ADD CONSTRAINT financial_failure CHECK(referencia_id<>'fail')");
    const before = await scalar('select sum(recovered_centavos) n from wallet_financial_allocations');
    await expect(settle('fail', 100)).rejects.toThrow();
    expect(await scalar('select sum(recovered_centavos) n from wallet_financial_allocations')).toBe(before);
    await db.exec('ALTER TABLE wallet_movimientos DROP CONSTRAINT financial_failure');
  });
  it('does not consume another merchant, official, or courtesy funds', async () => {
    await db.exec(`UPDATE workspace_subscriptions SET estado='cortesia' WHERE workspace_id='${ws}'`);
    await settle('courtesy',100);
    expect(await scalar("select count(*) n from wallet_financial_recoveries where operation_id='courtesy'")).toBe(0);
    await db.exec(`UPDATE workspace_subscriptions SET estado='activa',modelo_cobro='oficial' WHERE workspace_id='${ws}'`);
    await settle('official',100);
    expect(await scalar("select count(*) n from wallet_financial_recoveries where operation_id='official'")).toBe(0);
    await db.exec(`UPDATE workspace_subscriptions SET modelo_cobro='saldo' WHERE workspace_id='${ws}'`);
  });
  it('caps recovery at the actual fee, not a perpetual markup', async () => {
    await settle('large',10000);
    expect(await scalar('select sum(recovered_centavos) n from wallet_financial_allocations')).toBe(109);
    await settle('exhausted',100);
    expect(await scalar("select count(*) n from wallet_financial_recoveries where operation_id='exhausted'")).toBe(0);
  });
  it('rejects missing topups, historical receipts and processing already deducted', async () => {
    await fee('missing',50,'processing','pi_missing');
    await db.exec(`INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,stripe_id) VALUES('${ws}','consumo','comision_stripe',-59,'pi_new:comision');`);
    await fee('already-paid',59);
    await db.query("select wallet_financial_import('historical','instant_payout',50,'2020-01-01','{}',$1::jsonb)", [JSON.stringify([{ fundingId:'pi_new', workspaceId:ws, allocatedCents:50, basisCents:1000 }])]);
    expect(await scalar("select count(*) n from wallet_financial_allocations where receipt_id in ('missing','already-paid','historical')")).toBe(0);
  });
  it('stops future recovery after a funding refund and counts zero-debit expenses', async () => {
    await fee('another-instant',50,'instant_payout');
    await db.exec(`INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,costo_centavos,detalle)
      VALUES('${ws}','ajuste','recarga_ajuste',-1000,0,'{"paymentIntent":"pi_new"}'),('${ws}','consumo','comision_stripe',0,59,'{}');`);
    await settle('after-funding-refund',100);
    expect(await scalar("select count(*) n from wallet_financial_recoveries where operation_id='after-funding-refund'")).toBe(0);
    expect(await scalar("select sum(costo) n from wallet_business_totals('2000-01-01','2100-01-01')")).toBeGreaterThan(10000);
  });
});

