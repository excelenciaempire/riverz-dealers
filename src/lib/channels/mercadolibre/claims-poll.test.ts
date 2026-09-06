import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { closeResolvedClaimConversation } from './claims-poll';

function mockDb() {
  const result = { error: null };
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn().mockResolvedValue(result),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return {
    db: { from } as unknown as SupabaseClient,
    from,
    query,
  };
}

const connection = {
  id: 'connection-1',
  workspace_id: 'workspace-1',
} as ChannelConnection;

describe('Mercado Libre claim conversation state', () => {
  it('closes the matching Riverz thread when Mercado Libre closes the claim', async () => {
    const { db, from, query } = mockDb();

    await closeResolvedClaimConversation(db, connection, {
      id: 5572056476,
      status: 'closed',
      last_updated: '2026-09-05T20:13:36.000Z',
      resolution: {
        reason: 'payment_refunded',
        date_created: '2026-09-05T20:13:36.000Z',
      },
    });

    expect(from).toHaveBeenCalledWith('conversations');
    expect(query.update).toHaveBeenCalledWith({
      status: 'closed',
      closed_at: '2026-09-05T20:13:36.000Z',
    });
    expect(query.eq).toHaveBeenNthCalledWith(1, 'workspace_id', 'workspace-1');
    expect(query.eq).toHaveBeenNthCalledWith(
      2,
      'connection_id',
      'connection-1'
    );
    expect(query.eq).toHaveBeenNthCalledWith(
      3,
      'thread_external_id',
      'claim:5572056476'
    );
    expect(query.neq).toHaveBeenCalledWith('status', 'closed');
  });

  it('leaves the Riverz thread alone while the claim remains open', async () => {
    const { db, from } = mockDb();

    await closeResolvedClaimConversation(db, connection, {
      id: 5572056476,
      status: 'opened',
    });

    expect(from).not.toHaveBeenCalled();
  });
});
