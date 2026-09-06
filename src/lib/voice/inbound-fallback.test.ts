import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: {
    phone_number: '+12099793169',
    inbound_enabled: true,
    fallback_transfer_number: '+13055550123',
    fallback_language: 'es',
  } as Record<string, unknown>,
  agent: null as Record<string, unknown> | null,
  agents: [] as Record<string, unknown>[],
  wallet: { puede: true, motivo: null as string | null, saldoCentavos: 1000 },
  motorOff: false,
  aiBlocking: false,
  inserted: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/db/paginate', () => ({
  selectAll: async () => [
    { workspace_id: 'ws-1', config: state.config, status: 'connected' },
  ],
}));
vi.mock('./agents', () => ({
  pickInboundVoiceAgent: async () => state.agent,
  pickVoiceAgent: async () => state.agent,
  listVoiceAgents: async () => state.agents,
}));
vi.mock('@/lib/wallet/puerta', () => ({
  puertaDeIa: async () => state.wallet,
}));
vi.mock('@/lib/workspaces/motor', () => ({
  motorApagado: async () => state.motorOff,
}));
vi.mock('./provider-health', () => ({
  voiceProviderHealth: async () => ({ aiBlocking: state.aiBlocking }),
}));

import { resolveInboundCall } from './inbound';

function db() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'like', 'order', 'limit'])
        q[method] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (resolve: (value: { data: unknown[] }) => unknown) =>
        resolve({ data: [] });
      q.insert = (row: Record<string, unknown>) => {
        state.inserted = row;
        const inserted = {
          ...row,
          id: 'call-1',
          context: row.context ?? {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.single = async () => ({ data: inserted, error: null });
        return chain;
      };
      if (table === 'contacts') {
        q.single = async () => ({ data: { id: 'contact-1' }, error: null });
      }
      return q;
    },
  } as never;
}

const AGENT = {
  id: 'agent-1',
  language: 'es',
  voice_accepts_inbound: true,
  scope: 'workspace',
  priority: 10,
};

beforeEach(() => {
  state.config = {
    phone_number: '+12099793169',
    inbound_enabled: true,
    fallback_transfer_number: '+13055550123',
    fallback_language: 'es',
  };
  state.agent = AGENT;
  state.agents = [AGENT];
  state.wallet = { puede: true, motivo: null, saldoCentavos: 1000 };
  state.motorOff = false;
  state.aiBlocking = false;
  state.inserted = null;
});

describe('inbound fallback', () => {
  it('uses the normal agent when every gate is healthy', async () => {
    const result = await resolveInboundCall(db(), {
      did: '+12099793169',
      caller: '+13055550000',
    });
    expect(result).toMatchObject({ ok: true, mode: 'ai' });
    expect(state.inserted?.agent_id).toBe('agent-1');
  });

  it('returns fallback instead of 409 when there is no inbound agent', async () => {
    state.agent = null;
    state.agents = [];
    const result = await resolveInboundCall(db(), {
      did: '+12099793169',
      caller: '+13055550000',
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'fallback',
      reason: 'no_voice_agent',
      transferNumber: '+13055550123',
    });
    expect(state.inserted?.agent_id).toBeNull();
  });

  it('falls back without balance', async () => {
    state.wallet = { puede: false, motivo: 'sin_saldo', saldoCentavos: 0 };
    const result = await resolveInboundCall(db(), {
      did: '+12099793169',
      caller: '+13055550000',
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'fallback',
      reason: 'sin_saldo',
    });
  });

  it('distinguishes exhausted capacity from a missing agent', async () => {
    state.agent = null;
    state.agents = [AGENT];
    const result = await resolveInboundCall(db(), {
      did: '+12099793169',
      caller: '+13055550000',
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'fallback',
      reason: 'capacity_unavailable',
    });
  });

  it('still returns a hang-up fallback when no human number exists', async () => {
    state.agent = null;
    state.agents = [];
    delete state.config.fallback_transfer_number;
    const result = await resolveInboundCall(db(), {
      did: '+12099793169',
      caller: '+13055550000',
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'fallback',
      transferNumber: null,
    });
  });
});
