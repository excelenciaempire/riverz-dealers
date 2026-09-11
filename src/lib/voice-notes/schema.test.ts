import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('applies voice-note schema and isolates libraries by workspace', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select current_setting('request.jwt.claim.sub', true)::uuid $$;
      create table workspaces(id uuid primary key);
      create table workspace_members(workspace_id uuid, user_id uuid);
      create table broadcasts(id uuid); create table ai_agents(id uuid); create table ai_pending_replies(id uuid);
      insert into workspaces values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
      insert into workspace_members values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');`);
    await db.exec(
      readFileSync('supabase/migrations/256_voice_notes.sql', 'utf8')
    );
    await db.exec(`insert into voice_note_templates(workspace_id, name, config) values
      ('00000000-0000-0000-0000-000000000001', 'Own', '{"text":"Hola"}'),
      ('00000000-0000-0000-0000-000000000002', 'Other', '{"text":"Private"}');
      grant usage on schema public, auth to authenticated;
      grant select on workspace_members to authenticated;
      grant select, insert, update, delete on voice_note_templates to authenticated;
      set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001'; set role authenticated;`);
    const result = await db.query('select name from voice_note_templates');
    expect(result.rows).toEqual([{ name: 'Own' }]);
    await expect(
      db.exec(
        `insert into voice_note_templates(workspace_id, name, config) values ('00000000-0000-0000-0000-000000000002', 'Attack', '{}')`
      )
    ).rejects.toThrow(/row-level security/);
  } finally {
    await db.close();
  }
}, 20000);
