import { expect, it, vi } from 'vitest';
import {
  serviceActivity,
  summarizeServiceActivity,
  type ServiceMessage,
} from './service-activity';
const row = (
  id: string,
  extra: Partial<ServiceMessage> = {}
): ServiceMessage => ({
  id,
  sender_type: 'bot',
  origin: 'ai_agent',
  status: 'sent',
  channel: 'whatsapp',
  conversations: { channel: 'whatsapp', contact_id: 'c1' },
  ...extra,
});
it('separates sent AI bubbles from automation, manual sends and comments; deduplicates contacts', () => {
  const result = summarizeServiceActivity([
    row('1'),
    row('2'),
    row('3', { origin: 'automation' }),
    row('4', { sender_type: 'agent', origin: null }),
    row('5', { channel: 'fb_comment', origin: 'comment_ai' }),
    row('6', { origin: null }),
    row('1'),
  ]);
  expect(result).toMatchObject({
    contacts: 1,
    aiContacts: 1,
    sent: 6,
    aiMessages: 3,
    automated: 1,
    human: 1,
    other: 1,
    comments: 1,
  });
  expect(result.byChannel.reduce((n, c) => n + c.sent, 0)).toBe(6);
});
it('never counts drafts, failed deliveries, customer messages or attempts as sent', () => {
  expect(
    summarizeServiceActivity([
      row('1', { status: 'failed' }),
      row('2', { status: 'sending' }),
      row('3', { sender_type: 'customer' }),
      row('4', { status: 'pending' }),
    ]).sent
  ).toBe(0);
});
it('does not invent contacts when identity is missing', () => {
  expect(
    summarizeServiceActivity([
      row('1', { conversations: { channel: 'gmail', contact_id: null } }),
    ])
  ).toMatchObject({ sent: 1, contacts: 0, aiContacts: 0 });
});
it('recognizes comment AI even when persisted as an agent sender', () => {
  expect(
    summarizeServiceActivity([
      row('comment', {
        sender_type: 'agent',
        origin: 'comment_ai',
        channel: 'ig_comment',
      }),
    ])
  ).toMatchObject({ aiMessages: 1, aiContacts: 1, human: 0, comments: 1 });
});
it('paginates all confirmed sends and scopes every page to the merchant and date range', async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => row(String(i)));
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn((a: number, b: number) =>
      Promise.resolve({ data: rows.slice(a, b + 1), error: null })
    ),
  };
  const result = await serviceActivity(
    { from: () => q } as never,
    'workspace',
    { desde: 'start', hasta: 'end' }
  );
  expect(result.sent).toBe(1201);
  expect(q.eq).toHaveBeenCalledWith('conversations.workspace_id', 'workspace');
  expect(q.range).toHaveBeenCalledTimes(2);
  expect(q.lt).toHaveBeenCalledWith('created_at', 'end');
});
it('propagates query failures instead of reporting zero', async () => {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    gte: () => q,
    lt: () => q,
    order: () => q,
    range: () =>
      Promise.resolve({ data: null, error: new Error('unavailable') }),
  };
  await expect(
    serviceActivity({ from: () => q } as never, 'workspace', {
      desde: 'start',
      hasta: 'end',
    })
  ).rejects.toThrow('unavailable');
});
