import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ post: vi.fn(), filters: [] as unknown[][], receipts: [] as Record<string, unknown>[], lookupError: false, receiptError: false,
  endpoints: [] as Array<{ id: string; workspace_id: string; is_active: boolean; url: string; secret: string }> }));
vi.mock('@/lib/security/post-public-webhook', async () => ({ ...await vi.importActual<typeof import('@/lib/security/post-public-webhook')>('@/lib/security/post-public-webhook'), postPublicWebhook: h.post }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  const predicates: Array<(row: (typeof h.endpoints)[number]) => boolean> = [];
  const q = { select: () => q, eq: (key: string, value: unknown) => { h.filters.push([key, value]); predicates.push(row => row[key as keyof typeof row] === value); return q; },
    contains: (key: string, value: unknown) => { h.filters.push([key, value]); return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: h.endpoints.filter(row => predicates.every(predicate => predicate(row))), error: h.lookupError ? {} : null }).then(resolve),
    insert: async (receipt: Record<string, unknown>) => { if (table !== 'webhook_deliveries') throw new Error('unexpected write'); h.receipts.push(receipt); return { error: h.receiptError ? {} : null }; },
  }; return q;
} }) }));
import { emitWebhook } from './outbound';
import { WebhookPostError } from '@/lib/security/post-public-webhook';
beforeEach(() => { h.post.mockReset().mockResolvedValue(202); h.filters.length = 0; h.receipts.length = 0; h.lookupError = false; h.receiptError = false;
  h.endpoints = [{ id: 'own', workspace_id: 'business', is_active: true, url: 'https://receiver.test', secret: 'fixture-secret' },
    { id: 'foreign', workspace_id: 'other', is_active: true, url: 'https://other.test', secret: 'other-fixture' }]; });
describe('signed delivery receipts within the current business', () => {
  it('sends the original signed envelope only to current active destinations', async () => {
    expect(await emitWebhook('business', 'message.sent', { content: 'fixture' })).toEqual({ attempted: 1, succeeded: 1, failed: 0, unavailable: false });
    expect(h.filters).toContainEqual(['workspace_id', 'business']); expect(h.filters).toContainEqual(['is_active', true]);
    expect(h.filters).toContainEqual(['events', ['message.sent']]); expect(h.post).toHaveBeenCalledOnce();
    const [url, body, headers] = h.post.mock.calls[0]; const envelope = JSON.parse(body);
    expect(url).toBe('https://receiver.test'); expect(envelope).toMatchObject({ type: 'message.sent', data: { content: 'fixture' } });
    expect(headers['x-riverz-signature']).toBe(`sha256=${createHmac('sha256', 'fixture-secret').update(body).digest('hex')}`);
    expect(h.receipts[0]).toMatchObject({ endpoint_id: 'own', event_id: envelope.id, succeeded: true, status_code: 202 });
  });
  it('cannot test another business endpoint by id and ignores disabled destinations', async () => {
    expect((await emitWebhook('business', 'message.sent', {}, 'foreign')).attempted).toBe(0);
    h.endpoints[0].is_active = false;
    expect((await emitWebhook('business', 'message.sent', {}, 'own')).attempted).toBe(0);
    expect(h.post).not.toHaveBeenCalled(); expect(h.receipts).toHaveLength(0);
  });
  it('records a redirect as unsuccessful rather than confirmed delivery', async () => {
    h.post.mockResolvedValue(307);
    expect((await emitWebhook('business', 'message.sent', {})).failed).toBe(1);
    expect(h.receipts[0]).toMatchObject({ succeeded: false, status_code: 307, error_message: 'webhook_redirect_rejected' });
  });
  it.each(['blocked', 'unknown'])('records a sanitized %s transport failure without a retry', async reason => {
    h.post.mockRejectedValue(reason === 'blocked' ? new WebhookPostError('webhook_destination_forbidden') : new Error('secret private customer value'));
    expect((await emitWebhook('business', 'message.sent', {})).failed).toBe(1);
    expect(h.post).toHaveBeenCalledOnce(); expect(JSON.stringify(h.receipts)).not.toContain('private customer');
    expect(h.receipts[0]).toMatchObject({ succeeded: false, status_code: null });
  });
  it('distinguishes failed lookup from a missing endpoint before any external work', async () => {
    h.lookupError = true;
    expect(await emitWebhook('business', 'message.sent', {})).toEqual({ attempted: 0, succeeded: 0, failed: 0, unavailable: true });
    expect(h.post).not.toHaveBeenCalled();
  });
  it('reports an unavailable receipt even if the receiver returned 2xx', async () => {
    h.receiptError = true;
    expect(await emitWebhook('business', 'message.sent', {})).toEqual({ attempted: 1, succeeded: 1, failed: 0, unavailable: true });
    expect(h.post).toHaveBeenCalledOnce();
  });
});
