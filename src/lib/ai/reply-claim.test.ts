import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aiReplyClaimId,
  aiTextMessageId,
  claimAiReplyTurn,
} from './reply-claim';

function dbWith(error: { code?: string; message?: string } | null) {
  let inserted: unknown;
  const db = {
    from(table: string) {
      expect(table).toBe('ai_replies');
      return {
        insert(value: unknown) {
          inserted = value;
          return Promise.resolve({ error });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, inserted: () => inserted };
}

describe('claimAiReplyTurn', () => {
  const turn = {
    workspaceId: 'workspace',
    conversationId: 'conversation',
    inboundMessageId: 'inbound',
    agentId: 'agent',
  };

  it('deja continuar solamente al ganador de la reserva', async () => {
    const first = dbWith(null);
    const duplicate = dbWith({ code: '23505' });

    await expect(claimAiReplyTurn(first.db, turn)).resolves.toBe(true);
    await expect(claimAiReplyTurn(duplicate.db, turn)).resolves.toBe(false);
    expect(first.inserted()).toEqual({
      id: aiReplyClaimId('workspace', 'inbound'),
      agent_id: 'agent',
      workspace_id: 'workspace',
      conversation_id: 'conversation',
      message_id: 'inbound',
      status: 'skipped',
      skip_reason: 'dispatch_claim',
      created_at: '1970-01-01T00:00:00.000Z',
    });
  });

  it('no oculta fallos reales de base de datos', async () => {
    const broken = dbWith({ code: '08006', message: 'database unavailable' });
    await expect(claimAiReplyTurn(broken.db, turn)).rejects.toMatchObject({
      code: '08006',
    });
  });
});

describe('aiTextMessageId', () => {
  it('es estable por turno y distinto para cada burbuja', () => {
    const first = aiTextMessageId('conversation', 'inbound', 0);
    expect(aiTextMessageId('conversation', 'inbound', 0)).toBe(first);
    expect(aiTextMessageId('conversation', 'inbound', 1)).not.toBe(first);
    expect(aiTextMessageId('conversation', 'other-inbound', 0)).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
