import { describe, expect, it, vi } from 'vitest';
import { resolveHumanAttention } from './human-attention';

const reply = { conversation_id: 'efra', sender_type: 'agent', status: 'delivered', created_at: '2026-09-21T00:28:11Z', origin: null };
function database() {
  const q = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockResolvedValue({ error: null }) };
  const db = { from: vi.fn().mockReturnValue(q) };
  return { q, db };
}
describe('pending human attention', () => {
  it('clears an answered alert atomically without changing AI or chat status', async () => {
    const { db, q } = database();
    await resolveHumanAttention(db as never, reply);
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ needs_human_reason: null, needs_human_at: null, needs_human_summary: null }));
    expect(q.update.mock.calls[0][0]).not.toHaveProperty('ai_enabled');
    expect(q.update.mock.calls[0][0]).not.toHaveProperty('status');
    expect(q.eq).toHaveBeenCalledWith('id', 'efra');
    expect(q.lte).toHaveBeenCalledWith('needs_human_at', reply.created_at);
  });
  it.each(['failed', 'sending', null])('keeps attention when the message is %s', async status => {
    const { db } = database();
    await resolveHumanAttention(db as never, { ...reply, status });
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each([{ sender_type: 'customer' }, { sender_type: 'bot' }, { origin: 'ai_agent' }, { origin: 'automation' }, { status: 'sent', held_for_quality: true }])('ignores nonhuman or held replies: %j', async patch => {
    const { db } = database();
    await resolveHumanAttention(db as never, { ...reply, ...patch });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('handles a manual voice note and a delivered held template', async () => {
    const { db, q } = database();
    await resolveHumanAttention(db as never, { ...reply, origin: 'manual' });
    await resolveHumanAttention(db as never, { ...reply, held_for_quality: true });
    expect(q.update).toHaveBeenCalledTimes(2);
  });
  it('does not turn a successful send into a failed response if alert cleanup fails', async () => {
    const { db, q } = database();
    q.lte.mockRejectedValue(new Error('database unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveHumanAttention(db as never, reply)).resolves.toBeUndefined();
    log.mockRestore();
  });
});
