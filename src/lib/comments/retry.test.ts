import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const mocks = vi.hoisted(() => ({ sync: vi.fn(), send: vi.fn(), paused: vi.fn(), motor: vi.fn(), credit: vi.fn() }));
vi.mock('@/lib/billing/external-replies', () => ({ syncExternalReplies: mocks.sync }));
vi.mock('@/lib/billing/read-only', () => ({ workspaceReadOnly: mocks.paused }));
vi.mock('@/lib/workspaces/motor', () => ({ motorApagado: mocks.motor }));
vi.mock('@/lib/wallet/puerta', () => ({ puertaDeIa: mocks.credit }));
vi.mock('@/lib/instagram-agent/controls', () => ({ loadCommentSettings: async () => ({ publicReply: true, facebook: true }) }));
vi.mock('@/lib/instagram-agent/realtime', () => ({ replyToComment: mocks.send }));
import { recoverableCommentFailure, retryFailedComments } from './retry';

function fixture(attempts = 1) {
  const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
  const conversation = { id: 'case', workspace_id: 'ws', contact_id: 'person', connection_id: 'connection',
    channel: 'fb_comment', ai_enabled: true, assigned_agent_id: null, status: 'open', deleted_at: null,
    is_spam: false, last_message_hidden: false };
  const inbound = { id: 'inbound', conversation_id: 'case', message_id: 'meta-comment',
    created_at: '2026-09-30T12:00:00Z', content_text: 'Info por favor', sender_type: 'customer' };
  const db = {
    rpc: async () => ({ data: [{ inbound_message_id: 'inbound', workspace_id: 'ws', conversation_id: 'case', lease_id: 'lease', attempts }] }),
    from: (table: string) => {
      const value = table === 'conversations' ? conversation : table === 'messages' ? inbound
        : table === 'comments_meta' ? { post_id: 'post', connection_id: 'connection' }
        : table === 'contacts' ? { id: 'person', name: 'Cliente', external_id: 'recipient' }
        : table === 'channel_connections' ? { id: 'connection', workspace_id: 'ws', channel: 'fb_comment', status: 'connected' } : null;
      const q = { select: () => q, eq: () => q, is: () => q,
        single: async () => ({ data: value }),
        update: (values: Record<string, unknown>) => { writes.push({ table, values }); return q; },
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, writes, conversation, inbound };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.paused.mockResolvedValue(false); mocks.motor.mockResolvedValue(false);
  mocks.credit.mockResolvedValue({ puede: true }); mocks.send.mockResolvedValue(null);
  mocks.sync.mockResolvedValue({ publicCommentAnswered: false });
});
describe('verified comment recovery', () => {
  it('queues delivery and balance failures, not moderation or human decisions', () => {
    for (const reason of ['comment_error', 'comment_no_se_pudo_publicar', 'comment_sin_saldo']) expect(recoverableCommentFailure(reason)).toBe(true);
    for (const reason of ['comment_spam', 'comment_ya_oculto', 'comment_pide_humano', 'comment_espera_aprobacion']) expect(recoverableCommentFailure(reason)).toBe(false);
  });
  it('does not duplicate a reply already found on Meta', async () => {
    const { db, writes } = fixture(); mocks.sync.mockResolvedValue({ publicCommentAnswered: true });
    await retryFailedComments(db); expect(mocks.send).not.toHaveBeenCalled();
    expect(writes[0].values).toMatchObject({ status: 'done', outcome: 'already_answered_on_meta' });
  });
  it('never sends when external verification fails and exposes exhaustion for review', async () => {
    const { db, writes } = fixture(3); mocks.sync.mockRejectedValue(new Error('external_history_unavailable'));
    await retryFailedComments(db); expect(mocks.send).not.toHaveBeenCalled();
    expect(writes[0].values).toMatchObject({ status: 'review', outcome: 'external_history_unavailable' });
  });
  it('honors human ownership and hidden comments', async () => {
    for (const field of ['assigned_agent_id', 'is_spam'] as const) {
      const { db, conversation } = fixture(); Object.assign(conversation, { [field]: field === 'assigned_agent_id' ? 'human' : true });
      await retryFailedComments(db);
    }
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('uses source-comment visibility instead of the newest thread preview', async () => {
    const { db, conversation } = fixture(); conversation.last_message_hidden = true;
    mocks.sync.mockResolvedValueOnce({ publicCommentAnswered: false }).mockResolvedValueOnce({ publicCommentAnswered: true });
    expect(await retryFailedComments(db)).toEqual({ attempted: 1, recovered: 1 });
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('does not reply to a hidden source comment', async () => {
    const { db, inbound } = fixture(); Object.assign(inbound, { is_hidden: true });
    await retryFailedComments(db);
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('waits for credit without consuming technical retry attempts', async () => {
    const { db, writes } = fixture(3); mocks.credit.mockResolvedValue({ puede: false });
    await retryFailedComments(db); expect(mocks.send).not.toHaveBeenCalled();
    expect(writes[0].values).toMatchObject({ status: 'pending', attempts: 2, outcome: 'ia_balance_paused' });
  });
  it('recovers only the public answer and requires provider confirmation afterwards', async () => {
    const { db, writes } = fixture();
    mocks.sync.mockResolvedValueOnce({ publicCommentAnswered: false }).mockResolvedValueOnce({ publicCommentAnswered: true });
    expect(await retryFailedComments(db)).toEqual({ attempted: 1, recovered: 1 });
    expect(mocks.send).toHaveBeenCalledWith(db, expect.objectContaining({ publicOnly: true, commentId: 'meta-comment', commentChannel: 'fb_comment' }));
    expect(writes[0].values).toMatchObject({ status: 'done', outcome: 'public_reply_verified' });
  });
});
