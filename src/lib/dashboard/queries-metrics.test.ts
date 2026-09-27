import { expect, it } from 'vitest';
import { loadMetrics } from './queries';
function fixture(fail = false) {
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      let start = '',
        from = 0,
        to = 999;
      const q = {
        select: (_s: string, opts?: { head?: boolean }) => {
          if (table === 'messages' && opts?.head)
            throw Error('Separate message count is forbidden');
          return q;
        },
        eq: () => q,
        gte: (_k: string, v: string) => {
          start = v;
          return q;
        },
        lt: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          from = a;
          to = b;
          return q;
        },
        then: (resolve: (r: unknown) => unknown) => {
          calls.push(table);
          const rows = Array.from(
            { length: start.startsWith('2026-09-27') ? 1203 : 3 },
            (_, i) => ({
              conversation_id: 'c' + i,
              channel: i % 2 ? 'whatsapp' : 'gmail',
              sender_type: i % 3 ? 'bot' : 'customer',
            })
          );
          return Promise.resolve({
            error:
              fail && table === 'contacts' ? { message: 'unavailable' } : null,
            count: 2,
            data: table === 'messages' ? rows.slice(from, to + 1) : [],
          }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db, calls };
}
const range = {
  start: new Date('2026-09-27T03:00:00Z'),
  end: new Date('2026-09-28T03:00:00Z'),
};
const prev = { start: new Date('2026-09-26T03:00:00Z'), end: range.start };
it('reconciles message cards with paginated channel totals, including prior period', async () => {
  const { db } = fixture();
  const r = await loadMetrics(db as never, 'UTC', range, prev, {
    workspaceId: 'w',
  });
  expect(r.messagesReceived).toEqual({ current: 401, previous: 1 });
  expect(r.messagesSent).toEqual({ current: 802, previous: 2 });
  expect(r.channelMix.reduce((n, c) => n + c.inbound + c.outbound, 0)).toBe(
    1203
  );
  expect(r.conversations.current).toBe(1203);
});
it('does not turn failed counts into zero activity', async () => {
  await expect(
    loadMetrics(fixture(true).db as never, 'UTC', range, prev)
  ).rejects.toEqual({ message: 'unavailable' });
});
