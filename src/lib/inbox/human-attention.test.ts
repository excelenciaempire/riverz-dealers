import { describe, expect, it, vi } from 'vitest';
import {
  resolveHumanAttention,
  resolveHumanAttentionFromCustomerClosure,
} from './human-attention';

type TestReply = {
  id: string;
  conversation_id: string;
  sender_type: string;
  status: string | null;
  created_at: string;
  origin?: string | null;
  held_for_quality?: boolean | null;
};
const reply: TestReply = {
  id: 'manual-1',
  conversation_id: 'efra',
  sender_type: 'agent',
  status: 'delivered',
  created_at: '2026-09-21T00:28:11Z',
  origin: null,
};
function database(latest: TestReply = reply) {
  const read = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: latest, error: null }),
  };
  const write = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
  };
  write.lte
    .mockImplementationOnce(() => write)
    .mockResolvedValueOnce({ error: null });
  const db = {
    from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(write),
  };
  return { read, write, db };
}
describe('pending human attention', () => {
  it('clears an answered alert atomically without changing AI or chat status', async () => {
    const { db, write } = database();
    await resolveHumanAttention(db as never, reply);
    expect(write.update).toHaveBeenCalledWith(
      expect.objectContaining({
        needs_human_reason: null,
        needs_human_at: null,
        needs_human_summary: null,
      })
    );
    expect(write.update.mock.calls[0][0]).not.toHaveProperty('ai_enabled');
    expect(write.update.mock.calls[0][0]).not.toHaveProperty('status');
    expect(write.eq).toHaveBeenCalledWith('id', 'efra');
    expect(write.lte).toHaveBeenCalledWith('needs_human_at', reply.created_at);
    expect(write.lte).toHaveBeenCalledWith('last_message_at', reply.created_at);
  });
  it.each(['failed', 'sending', null])(
    'keeps attention when the message is %s',
    async (status) => {
      const { db } = database();
      await resolveHumanAttention(db as never, { ...reply, status });
      expect(db.from).not.toHaveBeenCalled();
    }
  );
  it.each([
    { sender_type: 'customer' },
    { sender_type: 'bot' },
    { origin: 'ai_agent' },
    { origin: 'automation' },
    { status: 'sent', held_for_quality: true },
  ])('ignores nonhuman or held replies: %j', async (patch) => {
    const { db } = database();
    await resolveHumanAttention(db as never, { ...reply, ...patch });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('handles a manual voice note and a delivered held template', async () => {
    const first = database({ ...reply, origin: 'manual' });
    await resolveHumanAttention(first.db as never, {
      ...reply,
      origin: 'manual',
    });
    const second = database({ ...reply, held_for_quality: true });
    await resolveHumanAttention(second.db as never, {
      ...reply,
      held_for_quality: true,
    });
    expect(first.write.update).toHaveBeenCalledTimes(1);
    expect(second.write.update).toHaveBeenCalledTimes(1);
  });
  it('keeps attention when the customer wrote again after the manual reply', async () => {
    const newer = {
      ...reply,
      id: 'customer-2',
      sender_type: 'customer',
      created_at: '2026-09-21T00:29:00Z',
    };
    const { db, write } = database(newer);
    await resolveHumanAttention(db as never, reply);
    expect(write.update).not.toHaveBeenCalled();
  });
  it('does not clear a customer closure without resolution evidence', async () => {
    const closure = {
      id: 'close-1',
      conversation_id: 'efra',
      sender_type: 'customer',
      status: 'delivered',
      created_at: '2026-09-21T00:30:00Z',
    };
    const { db, write } = database(closure);
    await resolveHumanAttentionFromCustomerClosure(db as never, closure);
    expect(write.update).not.toHaveBeenCalled();
  });
  it('does not turn a successful send into a failed response if alert cleanup fails', async () => {
    const { db, write } = database();
    write.lte.mockReset().mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      resolveHumanAttention(db as never, reply)
    ).resolves.toBeUndefined();
    log.mockRestore();
  });
});
