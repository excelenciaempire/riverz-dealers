import { describe, expect, it, vi } from 'vitest';
import { replyWasSuperseded } from './reply-freshness';

function database(data: unknown[], error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data, error }) };
  return { query, db: { from: vi.fn().mockReturnValue(query) } as never };
}
const inbound = { id: 'aaa', created_at: '2026-09-21T01:00:00Z' };
describe('last-moment reply freshness', () => {
  it('abandons a prepared correction question when the customer supplies the detail', async () => {
    const { db, query } = database([{ content_text: 'La talla es 39', media_url: null }]);
    expect(await replyWasSuperseded(db, 'conversation', inbound)).toBe(true);
    expect(query.eq).toHaveBeenCalledWith('conversation_id', 'conversation');
    expect(query.eq).toHaveBeenCalledWith('sender_type', 'customer');
    expect(query.or).toHaveBeenCalledWith('created_at.gt.2026-09-21T01:00:00Z,and(created_at.eq.2026-09-21T01:00:00Z,id.gt.aaa)');
  });
  it('waits for a new audio or image, but ignores empty events', async () => {
    expect(await replyWasSuperseded(database([{ media_url: '/api/media/audio.ogg' }]).db, 'c', inbound)).toBe(true);
    expect(await replyWasSuperseded(database([{ content_text: ' ', media_url: null }]).db, 'c', inbound)).toBe(false);
    expect(await replyWasSuperseded(database([]).db, 'c', inbound)).toBe(false);
  });
  it('does not send when the freshness check fails', async () => {
    await expect(replyWasSuperseded(database([], new Error('database unavailable')).db, 'c', inbound)).rejects.toThrow('database unavailable');
  });
});
