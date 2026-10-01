import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const f = vi.hoisted(() => ({ generate: vi.fn(), send: vi.fn(), prepare: vi.fn(), context: vi.fn() }));
vi.mock('@/lib/observability/latitude', () => ({ withLatitudeTrace: (_name: unknown, _meta: unknown, run: () => unknown) => run() }));
vi.mock('@/lib/channels/registry', () => ({ getAdapter: () => ({ sendText: f.send }) }));
vi.mock('@/lib/channels/send-guard', () => ({ storedConnectionCanSend: async () => true, assertStoredConnectionCanSend: async () => {}, isChannelDisconnectedError: () => false }));
vi.mock('@/lib/marketing/enlaces-salientes', () => ({ prepararTextoParaCanal: f.prepare }));
vi.mock('@/lib/wallet/puerta', () => ({ puedeUsarIa: async () => true }));
vi.mock('@/lib/workspaces/motor', () => ({ motorApagado: async () => false }));
vi.mock('@/lib/piloto', () => ({ puertaDelPiloto: async () => ({ permitido: true }) }));
vi.mock('./tool-context', () => ({ loadAgentToolContext: f.context }));
vi.mock('./toolbox', () => ({ toolEnabled: () => true }));
vi.mock('./platform-key', () => ({ resolveAnthropicKey: async () => ({ key: 'test-key', source: 'test' }) }));
vi.mock('./anthropic-client', () => ({ getAnthropic: () => ({ messages: { create: f.generate } }) }));
vi.mock('./guidance', () => ({ cargarReglas: async () => [], reglasATexto: () => '' }));
vi.mock('./registro-rioplatense', () => ({ resolverRegistro: async () => 'neutro', RIOPLATENSE_TEXTO: '' }));
vi.mock('./guardrails', () => ({ appendBusinessScopeGuardrails: () => {} }));
vi.mock('./estilo-humano', () => ({ estiloHumano: () => '', humanizarTexto: (text: string) => text }));
vi.mock('./salida', () => ({ largoDeChat: (text: string) => text }));
import { runFollowUp } from './followup';

function fixture(checkout = false, approval = false) {
  const args = {
    agent: { id: 'agent', workspace_id: 'ws', requires_approval: approval, reply_when_assigned: false, language: 'es', name: 'Assistant' },
    contact: { id: 'contact', workspace_id: 'ws', name: 'Customer' },
    connection: { id: 'connection', workspace_id: 'ws', channel: 'whatsapp' },
    conversation: {
      id: 'conversation', workspace_id: 'ws', contact_id: 'contact', connection_id: 'connection', channel: 'whatsapp',
      status: 'open', ai_enabled: true, last_sender_type: 'bot', last_message_at: '2026-10-01T12:00:00Z',
      followup_count: 0, followup_last_at: null, deleted_at: null,
      ...(checkout ? { pending_checkout_at: '2026-10-01T11:00:00Z', pending_checkout_url: 'https://shop.example/checkout' } : {}),
    },
    silenceHours: 1,
  } as unknown as Parameters<typeof runFollowUp>[1];
  const state = {
    consent: { data: { opted_out: false }, error: null } as { data: unknown; error: unknown },
    conversation: { data: { ...args.conversation }, error: null } as { data: Record<string, unknown> | null; error: unknown },
    checkouts: [] as Array<Record<string, unknown>>,
    checkoutError: null as unknown,
  };
  const writes = vi.fn();
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const db = {
    from: (table: string) => {
      const entry = { table, filters: [] as Array<[string, unknown]> };
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => { entry.filters.push([key, value]); return q; },
        order: () => q, limit: () => q,
        insert: (value: unknown) => { writes(table, 'insert', value); return q; },
        upsert: (value: unknown) => { writes(table, 'upsert', value); return q; },
        update: (value: unknown) => { writes(table, 'update', value); return q; },
        maybeSingle: async () => {
          reads.push(entry);
          if (table === 'contacts') return state.consent;
          if (table === 'shopify_checkouts') return { data: state.checkouts.find(row => entry.filters.every(([key, value]) => row[key] === value)) ?? null, error: state.checkoutError };
          return state.conversation;
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: table === 'messages' ? [{ sender_type: 'customer', content_text: 'Help' }, { sender_type: 'bot', content_text: 'Of course' }] : null, error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, args, state, reads, writes };
}

beforeEach(() => {
  f.context.mockImplementation(async (_db, agent) => agent);
  f.prepare.mockImplementation(async (_db, args) => args.texto);
  f.generate.mockResolvedValue({ content: [{ type: 'text', text: 'Can I help?' }] });
  f.send.mockResolvedValue({ externalMessageId: 'provider-id', status: 'sent' });
});

describe('actual AI follow-up send and approval paths', () => {
  it.each([false, true])('sends an eligible candidate, checkout=%s', async checkout => {
    const x = fixture(checkout);
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: true });
    expect(f.send).toHaveBeenCalledOnce();
    expect(x.reads.filter(r => r.table === 'contacts')).toHaveLength(2);
    expect(x.reads.filter(r => r.table === 'conversations')).toHaveLength(2);
    expect(x.writes).toHaveBeenCalledWith('messages', 'insert', expect.objectContaining({ origin: 'ai_followup' }));
    expect(f.generate).toHaveBeenCalledTimes(checkout ? 0 : 1);
  });
  it.each([false, true])('preserves required approval without sending, checkout=%s', async checkout => {
    const x = fixture(checkout, true);
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason: 'awaiting_approval' });
    expect(f.send).not.toHaveBeenCalled();
    expect(x.writes).toHaveBeenCalledWith('ai_pending_replies', 'upsert', expect.objectContaining({ workspace_id: 'ws', conversation_id: 'conversation' }));
  });
  it.each([
    [{ data: { opted_out: true }, error: null }, 'opted_out'],
    [{ data: null, error: { message: 'private database detail' } }, 'contact_unavailable'],
    [{ data: null, error: null }, 'contact_unavailable'],
  ] as const)('blocks before generation when consent is unavailable or revoked', async (consent, reason) => {
    const x = fixture(); x.state.consent = consent;
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason });
    expect(f.generate).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(x.writes).not.toHaveBeenCalled();
  });
  it('rejects cross-business context before loading tools or reading customer data', async () => {
    const x = fixture(); x.args.contact.workspace_id = 'foreign';
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason: 'context_mismatch' });
    expect(f.context).not.toHaveBeenCalled(); expect(x.reads).toHaveLength(0); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([false, true])('stops if consent is revoked while preparing, checkout=%s', async checkout => {
    const x = fixture(checkout);
    f.prepare.mockImplementation(async (_db, args) => { x.state.consent.data = { opted_out: true }; return args.texto; });
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason: 'opted_out' });
    expect(f.send).not.toHaveBeenCalled(); expect(x.writes).not.toHaveBeenCalled();
  });
  it.each([
    [{ last_sender_type: 'customer', last_message_at: '2026-10-01T12:05:00Z' }, 'conversation_changed'],
    [{ last_sender_type: 'agent', last_message_at: '2026-10-01T12:05:00Z' }, 'conversation_changed'],
    [{ ai_enabled: false }, 'conversation_ineligible'],
    [{ status: 'closed' }, 'conversation_ineligible'],
    [{ followup_count: 1 }, 'conversation_changed'],
  ] as const)('discards generated text if the conversation changed: %j', async (patch, reason) => {
    const x = fixture();
    f.generate.mockImplementation(async () => { Object.assign(x.state.conversation.data!, patch); return { content: [{ type: 'text', text: 'Can I help?' }] }; });
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason });
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.send).not.toHaveBeenCalled(); expect(x.writes).not.toHaveBeenCalled();
  });
  it('does not save a stale approval proposal after a customer reply', async () => {
    const x = fixture(false, true);
    f.generate.mockImplementation(async () => { x.state.conversation.data!.last_sender_type = 'customer'; return { content: [{ type: 'text', text: 'Can I help?' }] }; });
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason: 'conversation_changed' });
    expect(x.writes).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('does not suppress a payment follow-up because another business has an open cart for the same phone', async () => {
    const x = fixture(true); x.args.contact.phone = '+15550000001';
    x.state.checkouts.push({ id: 'foreign-cart', workspace_id: 'foreign', customer_phone: x.args.contact.phone, status: 'open' });
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: true });
    expect(f.send).toHaveBeenCalledOnce();
  });
  it.each(['phone', 'email'] as const)('defers to this business’s existing cart recovery matched by %s', async field => {
    const x = fixture(true);
    x.args.contact[field] = field === 'phone' ? '+15550000001' : 'customer+test@example.com';
    x.state.checkouts.push({ id: 'own-cart', workspace_id: 'ws', status: 'open', [`customer_${field}`]: x.args.contact[field] });
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason: 'cart_recovery_owns' });
    expect(f.generate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(x.writes).not.toHaveBeenCalled();
  });
  it('defers payment recovery if ownership cannot be verified', async () => {
    const x = fixture(true); x.args.contact.email = 'customer@example.com';
    x.state.checkoutError = { message: 'private database failure' };
    expect(await runFollowUp(x.db, x.args)).toEqual({ sent: false, reason: 'cart_recovery_unavailable' });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(x.writes).not.toHaveBeenCalled();
  });
});
