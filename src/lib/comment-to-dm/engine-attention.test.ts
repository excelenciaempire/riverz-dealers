import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ state: vi.fn(), send: vi.fn(), media: vi.fn(), claim: vi.fn() }));
vi.mock('@/lib/comments/private-attention', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/comments/private-attention')>(), readPrivateReplyState: m.state,
}));
vi.mock('@/lib/channels/registry', () => ({ getAdapter: () => ({ sendText: m.send, sendMedia: m.media }) }));
vi.mock('@/lib/channels/send-guard', () => ({ storedConnectionCanSend: async () => true, assertStoredConnectionCanSend: async () => {} }));
vi.mock('@/lib/marketing/enlaces-salientes', () => ({ prepararTextoParaCanal: async ({}, args: { texto: string }) => args.texto }));
vi.mock('@/lib/instagram-agent/private-reply-lock', () => ({ claimCommentPrivateReply: m.claim }));
vi.mock('@/lib/instagram-agent/controls', () => ({ proactiveGate: async () => ({ ok: true }), logProactiveSend: async () => {} }));
vi.mock('@/lib/instagram-agent/record-dm', () => ({ recordProactiveDm: async () => {}, recordPublicCommentReply: async () => {} }));
vi.mock('@/lib/ai/url-integrity', () => ({ stripPublicCommentUrls: (text: string) => text }));
import { processCommentForDmRules, type CommentEvent } from './engine';

const initial = { allowed: true, revision: 'before', brief: 'Cliente: consulta' };
const event = { workspaceId: 'store', channel: 'ig_comment', connection: { id: 'connection' },
  contact: { id: 'comment-contact', external_id: 'platform-person', name: 'Cliente' },
  commentId: 'comment', postId: 'post', parentCommentId: null, text: 'info' } as CommentEvent;
function database(publicReply = false, attachment = false) {
  const update = vi.fn();
  const rules = [{ id: 'rule', name: 'Info', post_id: null, keywords: ['info'], match_type: 'contains',
    public_reply_enabled: publicReply, public_reply_templates: ['Hola'], dm_message: 'Información',
    dm_attachment_url: attachment ? 'https://example.com/catalog.pdf' : null }];
  const db = { from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'insert', 'single', 'update'])
      q[method] = (...args: unknown[]) => { if (method === 'update') update(...args); return q; };
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'comment_to_dm_rules' ? rules : { id: 'log' }, error: null }).then(resolve);
    return q;
  } };
  return { db, update };
}
beforeEach(() => { vi.clearAllMocks(); m.state.mockReset().mockResolvedValue(initial); m.send.mockResolvedValue({ externalMessageId: 'sent' }); m.claim.mockResolvedValue(true); });
describe('static comment rules respect private support ownership', () => {
  it('does not claim or send when the private chat is escalated', async () => {
    m.state.mockResolvedValue({ ...initial, allowed: false });
    expect(await processCommentForDmRules(database(true, true).db as never, event)).toBe(true);
    expect(m.claim).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled(); expect(m.media).not.toHaveBeenCalled();
  });
  it('cancels before public reply when private context changes', async () => {
    m.state.mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, revision: 'new' });
    const { db, update } = database(true);
    await processCommentForDmRules(db as never, event);
    expect(m.send).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ dm_status: 'skipped', error: 'private_context_changed' }));
  });
  it('cancels before an attachment even after the private-reply claim', async () => {
    m.state.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, allowed: false });
    await processCommentForDmRules(database(false, true).db as never, event);
    expect(m.claim).toHaveBeenCalled(); expect(m.media).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it('sends an unchanged, unowned private reply exactly once', async () => {
    await processCommentForDmRules(database().db as never, event);
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'instagram', commentId: 'comment' }));
  });
});
