import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const ws = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const now = new Date();
const sample = { dropi_order_id: '100', account_id: '200', shop_id: '300', status: 'NOVEDAD', buyer_history: {} };
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid,
      shop_domain text, shopify_order_id text);
    INSERT INTO orders(workspace_id,shop_domain,shopify_order_id) VALUES
      ('${ws}','example.myshopify.com','10'),('${ws}','example.myshopify.com','11'),
      ('${other}','other.myshopify.com','10');`);
  await db.exec(readFileSync('supabase/migrations/299_dropi_order_evidence.sql', 'utf8'));
}, 60000);
afterAll(async () => db.close());
const record = async (workspace = ws, shop = 'example.myshopify.com', order = '10', time = now, evidence = sample) =>
  (await db.query<{result: string}>('SELECT record_dropi_order_evidence($1,$2,$3,$4,$5) AS result',
    [workspace, shop, order, time.toISOString(), JSON.stringify(evidence)])).rows[0].result;

it('enriches one existing order without creating another order', async () => {
  expect(await record()).toBe('updated');
  expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(3);
});
it('rejects replay and late snapshots without reverting current state', async () => {
  expect(await record()).toBe('stale_or_duplicate');
  expect(await record(ws, 'example.myshopify.com', '10', new Date(+now - 1))).toBe('stale_or_duplicate');
});
it('does not match order numbers across stores or workspaces', async () => {
  expect(await record(ws, 'other.myshopify.com')).toBe('order_not_mirrored');
  expect(await record(other)).toBe('order_not_mirrored');
  expect(await record(ws, 'example.myshopify.com', '999')).toBe('order_not_mirrored');
});
it('rejects changed Dropi identity and duplicate mapping to another order', async () => {
  await expect(record(ws, 'example.myshopify.com', '10', new Date(+now + 1),
    { ...sample, dropi_order_id: '999' })).rejects.toThrow('dropi_order_identity_conflict');
  await expect(record(ws, 'example.myshopify.com', '11')).rejects.toThrow();
});
it('reserves cross-workspace writes for service role', async () => {
  const result = await db.query<{allowed:boolean}>(`SELECT has_function_privilege('authenticated',
    'record_dropi_order_evidence(uuid,text,text,timestamptz,jsonb)','EXECUTE') AS allowed`);
  expect(result.rows[0].allowed).toBe(false);
});
