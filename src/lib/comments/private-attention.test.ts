import { describe, it, expect, vi } from 'vitest';
import { privateConversationAllowsCommentReply } from './private-attention';
function database(rows: unknown[], error: unknown = null, contacts = [{ id: 'private-contact' }]) {
  const eq = vi.fn(); const ids = vi.fn();
  function query(result: unknown) {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'is', 'limit']) q[name] = vi.fn((...args: unknown[]) => { if (name === 'eq') eq(...args); if (name === 'in') ids(...args); return q; });
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return q;
  }
  return { eq, ids, db: { from: vi.fn().mockReturnValueOnce(query({ data: contacts, error })).mockReturnValueOnce(query({ data: rows, error })) } };
}
const args = { workspaceId: 'rasmiaw', externalId: '1436903064992570', channel: 'instagram' as const };
describe('comment-to-private ownership', () => {
  it.each([{ ai_enabled: false }, { assigned_agent_id: 'person' }, { needs_human_reason: 'problema_detectado' }, { status: 'closed' }])('does not intrude on an owned or escalated DM: %j', row => {
    return expect(privateConversationAllowsCommentReply(database([row]).db as never, args)).resolves.toBe(false);
  });
  it('matches the private contact by platform identity, not the comment contact row ID', async () => {
    const { db, eq, ids } = database([{ ai_enabled: false }]);
    await privateConversationAllowsCommentReply(db as never, args);
    expect(eq).toHaveBeenCalledWith('workspace_id', 'rasmiaw');
    expect(eq).toHaveBeenCalledWith('external_id', args.externalId);
    expect(ids).toHaveBeenCalledWith('contact_id', ['private-contact']);
  });
  it('allows a new private chat or an existing unrestricted one', async () => {
    expect(await privateConversationAllowsCommentReply(database([], null, []).db as never, args)).toBe(true);
    expect(await privateConversationAllowsCommentReply(database([{ ai_enabled: true, status: 'open' }]).db as never, args)).toBe(true);
  });
  it('fails closed if ownership cannot be checked', async () => {
    expect(await privateConversationAllowsCommentReply(database([], { code: 'timeout' }).db as never, args)).toBe(false);
  });
});
