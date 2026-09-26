import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { savePollState } from './poll-state';

function database(rows: Array<{ config: unknown; status: string; last_error?: string | null }>, writes = [true]) {
  const patches: Array<Record<string, unknown>> = [];
  let read = 0;
  let write = 0;
  const db = { from: vi.fn(() => {
    let updating = false;
    const query = {
      select: vi.fn(() => updating
        ? Promise.resolve({ data: writes[write++] ? [{ id: 'c' }] : [], error: null })
        : query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      is: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: rows[Math.min(read++, rows.length - 1)], error: null })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updating = true;
        patches.push(patch);
        return query;
      }),
    };
    return query;
  }) } as unknown as SupabaseClient;
  return { db, patches };
}

describe('poll recovery state', () => {
  it('does not claim completion or clear a blocker while only saving progress', async () => {
    const { db, patches } = database([{ config: {}, status: 'error' }]);
    await savePollState(db, 'c', { cursor: 'next' }, null, { complete: false });
    expect(patches[0]).not.toHaveProperty('last_synced_at');
    expect(patches[0]).not.toHaveProperty('status');
    expect(patches[0]).not.toHaveProperty('last_error');
  });
  it('clears a stale error after a healthy pending pass without claiming completion', async () => {
    const { db, patches } = database([{ config: {}, status: 'error', last_error: 'comment_sync:partial:comments_graph_failed' }]);
    await savePollState(db, 'c', { comment_sync_complete: false }, null,
      { complete: false, clearErrorPrefix: 'comment_sync:' });
    expect(patches[0]).toMatchObject({ status: 'connected', last_error: null,
      config: { comment_sync_complete: false } });
    expect(patches[0]).not.toHaveProperty('last_synced_at');
  });
  it('does not clear an unrelated connection error during comment backlog progress', async () => {
    const { db, patches } = database([{ config: {}, status: 'error', last_error: 'webhook_subscription_failed' }]);
    await savePollState(db, 'c', { comment_sync_complete: false }, null,
      { complete: false, clearErrorPrefix: 'comment_sync:' });
    expect(patches[0]).not.toHaveProperty('status');
    expect(patches[0]).not.toHaveProperty('last_error');
  });
  it('restores a successful connection without rolling back renewed token metadata', async () => {
    const { db, patches } = database([{ config: { token_expires_at: 'new-expiry' }, status: 'error' }]);
    await savePollState(db, 'c', { last_poll_error: null });
    expect(patches[0]).toMatchObject({ status: 'connected', last_error: null,
      config: { token_expires_at: 'new-expiry', last_poll_error: null } });
  });

  it('re-reads configuration when a concurrent writer wins', async () => {
    const { db, patches } = database([
      { config: { token_expires_at: 'old' }, status: 'connected' },
      { config: { token_expires_at: 'rotated', last_push_at: 'now' }, status: 'connected' },
    ], [false, true]);
    await savePollState(db, 'c', { history_id: '123' });
    expect(patches[1].config).toEqual({ token_expires_at: 'rotated', last_push_at: 'now', history_id: '123' });
  });

  it('computes a function patch against the row that wins, so counters never lose a sum', async () => {
    const { db, patches } = database([
      { config: { history_chunks_received: 1 }, status: 'connected' },
      { config: { history_chunks_received: 2 }, status: 'connected' },
    ], [false, true]);
    await savePollState(db, 'c', (current) => ({
      history_chunks_received: Number(current.history_chunks_received ?? 0) + 1,
    }), null, { complete: false });
    expect(patches[1].config).toEqual({ history_chunks_received: 3 });
  });

  it('does not reconnect a deliberately disconnected account', async () => {
    const { db, patches } = database([{ config: {}, status: 'disconnected' }]);
    await savePollState(db, 'c', {});
    expect(patches).toHaveLength(0);
  });

  it('preserves an actual failed poll as an error', async () => {
    const { db, patches } = database([{ config: {}, status: 'connected' }]);
    await savePollState(db, 'c', {}, 'provider unavailable');
    expect(patches[0]).toMatchObject({ status: 'error', last_error: 'provider unavailable' });
    expect(patches[0]).not.toHaveProperty('last_synced_at');
  });

  it('fails visibly when concurrent writes exhaust the retry limit', async () => {
    const { db } = database([{ config: {}, status: 'connected' }], [false, false, false, false]);
    await expect(savePollState(db, 'c', {})).rejects.toThrow('concurrently');
  });
});
