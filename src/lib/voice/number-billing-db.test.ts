import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const ws = '00000000-0000-4000-8000-000000000001';
const ws2 = '00000000-0000-4000-8000-000000000002';
const user = '00000000-0000-4000-8000-000000000003';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_subscriptions(workspace_id uuid,estado text);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
    CREATE TABLE channel_connections(workspace_id uuid,channel text,config jsonb);
    CREATE TABLE wallet_accounts(workspace_id uuid PRIMARY KEY REFERENCES workspaces, saldo_centavos bigint DEFAULT 0,
      bloquear_sin_saldo boolean DEFAULT false, descubierto_centavos int DEFAULT 200,cobrar_a_costo boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE wallet_movimientos(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,tipo text,concepto text,centavos bigint,saldo_despues_centavos bigint,
      costo_centavos numeric,cantidad numeric,referencia_tipo text,referencia_id text,detalle jsonb);
    INSERT INTO workspaces VALUES('${ws}'),('${ws2}');
    INSERT INTO wallet_accounts(workspace_id,saldo_centavos) VALUES('${ws}',10000),('${ws2}',100);
    INSERT INTO workspace_members VALUES('${ws}','${user}','admin'),('${ws2}','${user}','admin');
    INSERT INTO workspace_subscriptions VALUES('${ws}','cortesia');`);
  await db.exec(readFileSync('supabase/migrations/253_wallet_provider_usage.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/262_voice_number_billing.sql', 'utf8'));
}, 20000);
afterAll(async () => db.close());
const claim = (workspace: string, phone: string) => db.query<{ id: string }>("select voice_number_claim($1,$2,'CO','local',1350,1350,$3) as id", [workspace, phone, user]);
describe('number ownership and billing transactions', () => {
  let id: string;
  it('rejects insufficient balance without leaving a subscription or hold', async () => {
    await expect(claim(ws2, '+576019191288')).rejects.toThrow('sin_saldo');
    expect((await db.query('select * from voice_number_subscriptions')).rows).toHaveLength(0);
  });
  it('allows only one simultaneous purchase per merchant', async () => {
    const results = await Promise.allSettled([claim(ws, '+576019191270'), claim(ws, '+576019191271')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const result = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof claim>>>;
    id = result.value.rows[0].id;
    const row = (await db.query<{ reservado_centavos: number }>('select * from wallet_accounts where workspace_id=$1', [ws])).rows[0];
    expect(Number(row.reservado_centavos)).toBe(2700);
  });
  it('settles once, including courtesy accounts, without touching another balance', async () => {
    for (let i = 0; i < 2; i++) await db.query('select voice_number_settle($1,$2)', [ws, `number:${id}:initial`]);
    const rows = (await db.query<{ saldo_centavos: number; reservado_centavos: number }>('select * from wallet_accounts order by workspace_id')).rows;
    expect(Number(rows[0].saldo_centavos)).toBe(7300);
    expect(Number(rows[0].reservado_centavos)).toBe(0);
    expect(Number(rows[1].saldo_centavos)).toBe(100);
    expect((await db.query('select * from wallet_movimientos')).rows).toHaveLength(1);
  });
  it('does not assign the same phone to another merchant', async () => {
    await db.query('update wallet_accounts set saldo_centavos=10000 where workspace_id=$1', [ws2]);
    const number = (await db.query<{ phone_number: string }>('select phone_number from voice_number_subscriptions')).rows[0].phone_number;
    await expect(claim(ws2, number)).rejects.toThrow('voice_number_phone_live');
  });
  it('reserves a renewal once and prevents cross-merchant reuse', async () => {
    const operation = `number:${id}:2026-10`;
    for (let i = 0; i < 2; i++) expect((await db.query<{ ok: boolean }>('select voice_number_reserve($1,$2,1350) as ok', [ws, operation])).rows[0].ok).toBe(true);
    await expect(db.query('select voice_number_reserve($1,$2,1350)', [ws2, operation])).rejects.toThrow('number_operation_mismatch');
    await db.query('select wallet_cancelar_reserva($1,$2)', [ws, operation]);
    await expect(db.query('select voice_number_settle($1,$2)', [ws, operation])).rejects.toThrow('number_reservation_cancelled');
  });
  it('rolls back settlement if ledger writing fails', async () => {
    await db.query("select voice_number_reserve($1,'rollback',100)", [ws]);
    await db.exec("ALTER TABLE wallet_movimientos ADD CONSTRAINT fail_test CHECK(referencia_id <> 'rollback')");
    await expect(db.query("select voice_number_settle($1,'rollback')", [ws])).rejects.toThrow();
    expect((await db.query<{ estado: string }>("select estado from wallet_operaciones where id='rollback'")).rows[0].estado).toBe('reservada');
    await db.exec('ALTER TABLE wallet_movimientos DROP CONSTRAINT fail_test');
  });
});
