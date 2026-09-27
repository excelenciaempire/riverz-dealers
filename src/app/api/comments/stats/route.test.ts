import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ fail: false, scopes: [] as string[] }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: (table: string) => {
      let kind = '';
      const q = {
        select: () => q,
        gte: () => q,
        in: (_key: string, values: string[]) => { kind = values.join(','); return q; },
        eq: (key: string, value: string) => {
          if (key === 'workspace_id') state.scopes.push(value);
          else kind = value;
          return q;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          count: table === 'comment_to_dm_log' ? 2 : kind === 'comment_public' ? 3 : 4,
          error: state.fail ? { message: 'unavailable' } : null,
        }).then(resolve),
      };
      return q;
    },
  }),
}));

import { GET } from './route';

describe('comment metrics', () => {
  beforeEach(() => { state.fail = false; state.scopes = []; });
  it('separates public replies from DMs and scopes all counters to the requested account', async () => {
    const response = await GET(new Request('https://riverz.co/api/comments/stats?workspace_id=riverzoficial'));
    expect(await response.json()).toEqual({ dms_sent: 4, public_replies: 5, days: 30 });
    expect(state.scopes).toEqual(['riverzoficial', 'riverzoficial', 'riverzoficial']);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('does not report false zeros when a source cannot be read', async () => {
    state.fail = true;
    const response = await GET(new Request('https://riverz.co/api/comments/stats?workspace_id=riverzoficial'));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('public_replies');
  });
});
