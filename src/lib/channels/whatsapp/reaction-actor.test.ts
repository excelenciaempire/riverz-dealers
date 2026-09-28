import { expect, it } from 'vitest';
import { reactionIdentityCandidates, whatsappReactionActor } from './reaction-actor';
it('accepts the complete Argentine identity with and without its mobile 9', () => {
  expect(reactionIdentityCandidates('5492634681085')).toEqual(['5492634681085', '542634681085']);
  expect(reactionIdentityCandidates('+57 300 123 4567')).toEqual(['573001234567']);
  expect(reactionIdentityCandidates('19544945872')).toEqual(['19544945872']);
});
it('scopes both lookups to the target thread and workspace', async () => {
  const filters: Array<[string, unknown]> = [];
  const db = { from: (table: string) => {
    const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      in: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: async () => ({ data: table === 'conversations' ? { contact_id: 'customer' } : { id: 'customer' }, error: null }) };
    return q;
  } };
  expect(await whatsappReactionActor(db as never, 'workspace', 'thread', '5492634681085')).toBe('customer');
  expect(filters.filter(([k]) => k === 'workspace_id')).toEqual([['workspace_id', 'workspace'], ['workspace_id', 'workspace']]);
  expect(filters).toContainEqual(['id', 'thread']); expect(filters).toContainEqual(['id', 'customer']);
  expect(filters).toContainEqual(['external_id', ['5492634681085', '542634681085']]);
});
