import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite();
const ws = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const email = '33333333-3333-4333-8333-333333333333';
const wa = '44444444-4444-4444-8444-444444444444';
const conv = '55555555-5555-4555-8555-555555555555';
const message = '66666666-6666-4666-8666-666666666666';
const token = 'abcdef012345abcdef012345';
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table workspaces(id uuid primary key);
    create table channel_connections(id uuid primary key, workspace_id uuid, channel text);
    create table conversations(id uuid primary key, workspace_id uuid, connection_id uuid);
    create table messages(id uuid primary key, conversation_id uuid, channel text, sender_type text, created_at timestamptz default now());`);
  await db.exec(
    readFileSync('supabase/migrations/338_email_whatsapp_referrals.sql', 'utf8')
  );
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    'truncate workspaces,channel_connections,conversations,messages,email_whatsapp_links,email_whatsapp_inquiries cascade'
  );
  await db.query('insert into workspaces values ($1),($2)', [ws, other]);
  await db.query(
    "insert into channel_connections values ($1,$3,'gmail'),($2,$3,'whatsapp')",
    [email, wa, ws]
  );
  await db.query(
    'insert into conversations(id,workspace_id,connection_id) values ($1,$2,$3)',
    [conv, ws, wa]
  );
  await db.query(
    "insert into messages values ($1,$2,'whatsapp','customer',now())",
    [message, conv]
  );
  await db.query(
    "insert into email_whatsapp_links(token,workspace_id,email_connection_id,whatsapp_connection_id,source_key,source_kind,order_name,prefill) values ($1,$2,$3,$4,'order-99','purchase_guide','#99','Hello')",
    [token, ws, email, wa]
  );
});
async function capture(overrides: unknown[] = []) {
  return (
    await db.query<{ result: unknown }>(
      'select record_email_whatsapp_inquiry($1,$2,$3,$4,$5) result',
      [token, ws, wa, conv, message].map((v, i) => overrides[i] ?? v)
    )
  ).rows[0].result;
}
describe('persisted email source validation', () => {
  it('counts clicks separately; they never create a conversation or inquiry', async () => {
    await Promise.all([
      db.query('select count_email_whatsapp_click($1)', [token]),
      db.query('select count_email_whatsapp_click($1)', [token]),
    ]);
    expect(
      (await db.query('select click_count from email_whatsapp_links')).rows
    ).toEqual([{ click_count: 2 }]);
    expect(
      (await db.query('select * from email_whatsapp_inquiries')).rows
    ).toHaveLength(0);
    expect(
      (await db.query('select email_referral from conversations')).rows
    ).toEqual([{ email_referral: null }]);
  });
  it('records and displays the verified source exactly once per message', async () => {
    const referral = await capture();
    expect(referral).toMatchObject({
      kind: 'purchase_guide',
      orderName: '#99',
    });
    await capture();
    expect(
      (await db.query('select * from email_whatsapp_inquiries')).rows
    ).toHaveLength(1);
    expect(
      (await db.query<{email_referral: unknown}>('select email_referral from conversations')).rows[0]
        .email_referral
    ).toEqual(referral);
  });
  it('rejects another workspace, mailbox, conversation, unknown token, and missing message', async () => {
    for (const args of [
      [undefined, other],
      [undefined, undefined, email],
      [undefined, undefined, undefined, other],
      ['000000000000000000000000'],
      [undefined, undefined, undefined, undefined, other],
    ])
      expect(await capture(args)).toBeNull();
    expect(
      (await db.query('select * from email_whatsapp_inquiries')).rows
    ).toHaveLength(0);
  });
  it('rejects outbound and historical messages even if a reference was copied', async () => {
    await db.exec("update messages set sender_type='agent'");
    expect(await capture()).toBeNull();
    await db.exec(
      "update messages set sender_type='customer',created_at=now()-interval '1 day'"
    );
    expect(await capture()).toBeNull();
  });
  it('keeps referral records inaccessible to public or authenticated browser clients', async () => {
    await db.exec('set role anon');
    await expect(
      db.query('select * from email_whatsapp_links')
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('select count_email_whatsapp_click($1)', [token])
    ).rejects.toThrow('permission denied');
    await db.exec('reset role; set role authenticated');
    await expect(
      db.query('select record_email_whatsapp_inquiry($1,$2,$3,$4,$5)', [
        token,
        ws,
        wa,
        conv,
        message,
      ])
    ).rejects.toThrow('permission denied');
    await db.exec('reset role');
  });
});
