import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { missingMediaText, repairStoredMetaMedia } from './repair-meta-media';

it('only treats empty and known attachment placeholders as missing media', () => {
  for (const text of [null, '', '[unsupported media]', '[Archivo no disponible]', '[Audio]']) expect(missingMediaText(text)).toBe(true);
  for (const text of ['Quiero un reembolso', 'Mira [Imagen]', 'https://example.com']) expect(missingMediaText(text)).toBe(false);
});

function fixture(rows: unknown[]) {
  const calls: unknown[][] = [];
  const writes: unknown[] = [];
  let updating = false;
  const q = { select: () => q, eq: (...args: unknown[]) => { calls.push(args); return q; },
    is: (...args: unknown[]) => { calls.push(args); return q; }, limit: () => q,
    update: (value: unknown) => { updating = true; writes.push(value); return q; },
    then: (resolve: (value: unknown) => void) => resolve({ data: updating ? [{ id: 'm' }] : rows, error: null }) };
  return { db: { from: () => q } as unknown as SupabaseClient, calls, writes };
}
const args = { workspaceId: 'workspace', externalMessageId: 'mid', channel: 'instagram', media: [{ url: 'storage://media/file', mime_type: 'audio/mp4' }] };

it('repairs the same stored message with tenant and snapshot guards, without an insert/send', async () => {
  const f = fixture([{ id: 'm', content_text: '[unsupported media]' }]);
  expect(await repairStoredMetaMedia(f.db, args)).toBe(true);
  expect(f.calls).toContainEqual(['conversations.workspace_id', 'workspace']);
  expect(f.calls).toContainEqual(['content_text', '[unsupported media]']);
  expect(f.writes[0]).toMatchObject({ content_type: 'audio', media_url: 'storage://media/file' });
});

it('preserves ordinary text and ambiguous duplicates instead of overwriting them', async () => {
  for (const rows of [[{ id: 'm', content_text: 'Consulta real' }], [{ id: 'm' }, { id: 'duplicate' }], []]) {
    const f = fixture(rows);
    expect(await repairStoredMetaMedia(f.db, args)).toBe(false);
    expect(f.writes).toHaveLength(0);
  }
});
