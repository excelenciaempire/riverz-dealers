import { beforeEach, describe, expect, it, vi } from 'vitest';
const pull = vi.hoisted(() => vi.fn());
const retry = vi.hoisted(() => vi.fn());
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: { started_at: new Date().toISOString() }, error: null }) };
  return { from: () => chain };
} }));
vi.mock('@/lib/channels/comment-sync', () => ({ reconcileAllCommentConnections: vi.fn() }));
vi.mock('@/lib/comments/retry', () => ({ retryFailedComments: retry }));
vi.mock('@/lib/channels/comment-pull', () => ({ pullCommentsAll: pull, pullCommentsForWorkspace: pull }));
vi.mock('@/lib/channels/publicacion-media', () => ({
  entenderPendientes: async () => ({}), identificarProductosPendientes: async () => ({}),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: vi.fn() }));
vi.mock('@/lib/cron/heartbeat', () => ({
  withCronRun: (_name: string, handler: unknown) => handler, withCronTask: vi.fn(),
}));
import { GET } from './route';
beforeEach(() => { retry.mockResolvedValue({ attempted: 0, recovered: 0 }); });
describe('comment recovery health', () => {
  it('keeps explicit historical backfills passive', async () => {
    retry.mockClear(); pull.mockResolvedValue({ detail: [] });
    const result = await GET(new Request('http://localhost/api/cron/comment-sync?workspace_id=ws&backfill_days=5'));
    expect(result.status).toBe(200);
    expect(retry).not.toHaveBeenCalled();
    expect(pull).toHaveBeenCalledWith(expect.anything(), 'ws', expect.objectContaining({ suppressAutoReply: true }));
  });
  it('exposes recovery failures in cron health', async () => {
    retry.mockRejectedValueOnce(new Error('comment_retry_claim_unavailable'));
    pull.mockResolvedValue({ detail: [] });
    const result = await GET(new Request('http://localhost/api/cron/comment-sync'));
    expect(result.status).toBe(207);
    expect((await result.json()).recovered.error).toBe('comment_retry_claim_unavailable');
  });
  it.each([{ error: 'comments_sync_pending', status: 200 }, { error: 'permission_denied', status: 207 }])(
    'reports $error correctly', async ({ error, status }) => {
      pull.mockResolvedValue({ detail: [{ errors: [error] }] });
      const result = await GET(new Request('http://localhost/api/cron/comment-sync'));
      expect(result.status).toBe(status);
      expect((await result.json()).pulled.detail[0].errors).toEqual([error]);
    },
  );
});
