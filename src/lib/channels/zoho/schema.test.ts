import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, test } from 'vitest';

test('migration 238 enables Zoho throughout the inbox and preserves workspace mailbox isolation', async () => {
  const db = new PGlite();
  try {
    for (const table of ['contacts', 'conversations', 'messages', 'channel_connections']) {
      await db.exec(`CREATE TABLE ${table} (workspace_id text, channel text CONSTRAINT ${table}_channel_check CHECK (channel IN ('gmail','outlook')), external_account_id text);`);
    }
    await db.exec('CREATE UNIQUE INDEX uq_active_connection_per_account ON channel_connections(workspace_id, channel, external_account_id);');
    await expect(db.exec("INSERT INTO channel_connections VALUES ('shop-a','zoho','info@example.com')")).rejects.toThrow(/channel_connections_channel_check/);
    const sql = readFileSync('supabase/migrations/238_zoho_mail_channel.sql', 'utf8');
    await db.exec(`BEGIN; ${sql} COMMIT;`);
    for (const table of ['contacts', 'conversations', 'messages', 'channel_connections']) {
      await db.exec(`INSERT INTO ${table} VALUES ('shop-a','zoho','info@example.com'), ('shop-b','zoho','info@example.com'), ('shop-a','gmail','other@example.com');`);
      const result = await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE channel='zoho'`);
      expect(result.rows).toEqual([{ count: 2 }]);
    }
    await expect(db.exec("INSERT INTO channel_connections VALUES ('shop-a','zoho','info@example.com')")).rejects.toThrow(/uq_active_connection_per_account/);
    await db.exec(sql); // Reapplying must remain safe with existing mailboxes.
  } finally {
    await db.close();
  }
});
