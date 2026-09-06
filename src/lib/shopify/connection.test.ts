import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ''),
}));

import { persistShopifyConnection } from './connection';

type ConnectionTarget = {
  id: string;
  user_id: string;
  workspace_id: string;
} | null;

function createDb(active: ConnectionTarget, prior: ConnectionTarget = null) {
  const reads = [active, prior];
  const calls = {
    inserted: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
    updateId: null as string | null,
  };

  const from = vi.fn(() => {
    let mutation: 'insert' | 'update' | null = null;
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        if (mutation === 'update' && column === 'id') calls.updateId = String(value);
        return chain;
      }),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: reads.shift() ?? null, error: null })),
      update: vi.fn((row: Record<string, unknown>) => {
        mutation = 'update';
        calls.updated.push(row);
        return chain;
      }),
      insert: vi.fn((row: Record<string, unknown>) => {
        mutation = 'insert';
        calls.inserted.push(row);
        return chain;
      }),
      single: vi.fn(async () => ({ data: { id: 'saved-connection' }, error: null })),
    };
    return chain;
  });

  return { db: { from } as unknown as SupabaseClient, calls, from };
}

const baseArgs = {
  userId: 'reconnecting-user',
  workspaceId: 'workspace-a',
  shopDomain: 'store.myshopify.com',
  accessToken: 'new-token',
  connectionMethod: 'oauth' as const,
};

describe('persistShopifyConnection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the active connection in the same workspace instead of inserting', async () => {
    const { db, calls } = createDb({
      id: 'existing-connection',
      user_id: 'original-installer',
      workspace_id: 'workspace-a',
    });

    await expect(persistShopifyConnection(db, baseArgs)).resolves.toEqual({
      id: 'saved-connection',
    });

    expect(calls.inserted).toHaveLength(0);
    expect(calls.updateId).toBe('existing-connection');
    expect(calls.updated).toHaveLength(1);
    expect(calls.updated[0]).toMatchObject({
      user_id: 'original-installer',
      workspace_id: 'workspace-a',
      platform: 'shopify',
      access_token: 'encrypted:new-token',
      status: 'active',
    });
  });

  it('rejects a shop that is active in another workspace', async () => {
    const { db, calls } = createDb({
      id: 'foreign-connection',
      user_id: 'another-user',
      workspace_id: 'workspace-b',
    });

    await expect(persistShopifyConnection(db, baseArgs)).rejects.toThrow(
      'Shopify shop is already connected to another workspace'
    );
    expect(calls.updated).toHaveLength(0);
    expect(calls.inserted).toHaveLength(0);
  });

  it('inserts when the shop has no active or prior workspace connection', async () => {
    const { db, calls } = createDb(null, null);

    await persistShopifyConnection(db, baseArgs);

    expect(calls.updated).toHaveLength(0);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0]).toMatchObject({
      user_id: 'reconnecting-user',
      workspace_id: 'workspace-a',
      platform: 'shopify',
      shop_domain: 'store.myshopify.com',
    });
  });
});
