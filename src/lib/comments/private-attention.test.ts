import { describe, it, expect, vi } from 'vitest';
import { privateConversationAllowsCommentReply, readPrivateReplyState, privateReplyStateIsCurrent } from './private-attention';
function database(rows: unknown[], error: unknown = null, contacts = [{ id: 'private-contact' }], messages: unknown[] = [], historyError: unknown = null) {
  const eq = vi.fn(); const ids = vi.fn();
  function query(result: unknown) {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'is', 'limit', 'neq', 'order']) q[name] = vi.fn((...args: unknown[]) => { if (name === 'eq') eq(...args); if (name === 'in') ids(...args); return q; });
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return q;
  }
  return { eq, ids, db: { from: vi.fn().mockReturnValueOnce(query({ data: contacts, error })).mockReturnValueOnce(query({ data: rows, error })).mockReturnValue(query({ data: messages, error: historyError })) } };
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

describe('private context freshness', () => {
  const chat = { id: 'private-chat', ai_enabled: true, status: 'open', last_message_at: '2026-09-28T12:00:00Z' };
  const inquiry = { id: 'inbound-1', conversation_id: chat.id, created_at: chat.last_message_at, sender_type: 'customer', content_text: 'Ya compré, necesito cambiar el rascador', held_for_quality: false };
  const state = (messages = [inquiry], chats: unknown[] = [chat]) => readPrivateReplyState(database(chats, null, undefined, messages).db as never, args);

  it('keeps the existing purchase complaint in the context supplied to every writer', async () => {
    const snapshot = await state();
    expect(snapshot.allowed).toBe(true);
    expect(snapshot.brief).toContain(inquiry.content_text);
    expect(snapshot.brief).toContain('sin reiniciar una venta');
    expect(snapshot.brief).toContain('Nunca publiques datos personales');
    expect(snapshot.revision).not.toContain(inquiry.content_text);
  });
  it('cancels a draft when a newer private message arrives before the conversation preview updates', async () => {
    const before = await state();
    const after = await state([{ ...inquiry, id: 'inbound-2', content_text: 'Solicito el reembolso' }, inquiry]);
    expect(privateReplyStateIsCurrent(before, after)).toBe(false);
  });
  it('cancels on an edited private message even when id and timestamp did not change', async () => {
    expect(privateReplyStateIsCurrent(await state(), await state([{ ...inquiry, content_text: 'No quiero comprar de nuevo' }]))).toBe(false);
  });
  it('cancels when a private chat is created during generation', async () => {
    const before = await readPrivateReplyState(database([], null, []).db as never, args);
    expect(privateReplyStateIsCurrent(before, await state())).toBe(false);
  });
  it.each([{ ai_enabled: false }, { needs_human_reason: 'problema_detectado' }, { assigned_agent_id: 'human' }, { status: 'closed' }])('cancels when ownership changes: %j', async change => {
    expect(privateReplyStateIsCurrent(await state(), await state([inquiry], [{ ...chat, ...change }]))).toBe(false);
  });
  it('allows a draft when history and ownership remain unchanged', async () => {
    expect(privateReplyStateIsCurrent(await state(), await state())).toBe(true);
  });
  it('does not allow a send when loading private history fails', async () => {
    const unavailable = await readPrivateReplyState(database([chat], null, undefined, [], { code: 'timeout' }).db as never, args);
    expect(unavailable).toEqual({ allowed: false, revision: null, brief: null });
    expect(privateReplyStateIsCurrent(await state(), unavailable)).toBe(false);
  });
  it('does not expose held drafts as messages the store already sent', async () => {
    const snapshot = await state([{ ...inquiry, sender_type: 'agent', held_for_quality: true }]);
    expect(snapshot.brief).toBeNull();
  });
});
