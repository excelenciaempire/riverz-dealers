import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { followUpBlockReason, followUpContextMatches } from './followup-eligibility';

const context = {
  agent: { workspace_id: 'ws', reply_when_assigned: false },
  contact: { id: 'contact', workspace_id: 'ws' },
  connection: { id: 'connection', workspace_id: 'ws', channel: 'whatsapp' },
  conversation: {
    id: 'conversation', workspace_id: 'ws', contact_id: 'contact', channel: 'whatsapp', connection_id: 'connection',
    status: 'open', ai_enabled: true, deleted_at: null, assigned_agent_id: null,
    last_message_at: '2026-10-01T12:00:00Z', last_sender_type: 'bot', followup_count: 0, followup_last_at: null,
  },
} as unknown as Parameters<typeof followUpBlockReason>[1];

function database(consent: unknown = { opted_out: false }, current: unknown = context.conversation, errorTable?: string) {
  const calls: Array<[string, string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const q = {
      select: vi.fn().mockReturnThis(),
      eq: (key: string, value: unknown) => { calls.push([table, key, value]); return q; },
      maybeSingle: async () => ({ data: table === 'contacts' ? consent : current, error: table === errorTable ? { message: 'private' } : null }),
    };
    return q;
  });
  return { db: { from } as unknown as SupabaseClient, from, calls };
}

describe('follow-up candidate and consent revalidation', () => {
  it('accepts a current eligible candidate and scopes both reads to its business', async () => {
    const f = database();
    expect(await followUpBlockReason(f.db, context)).toBeNull();
    expect(f.calls).toEqual([
      ['contacts', 'id', 'contact'], ['contacts', 'workspace_id', 'ws'],
      ['conversations', 'id', 'conversation'], ['conversations', 'workspace_id', 'ws'], ['conversations', 'contact_id', 'contact'],
    ]);
  });
  it.each([
    { agent: { ...context.agent, workspace_id: 'foreign' } },
    { contact: { ...context.contact, workspace_id: 'foreign' } },
    { contact: { ...context.contact, id: 'foreign' } },
    { connection: { ...context.connection, workspace_id: 'foreign' } },
    { connection: { ...context.connection, channel: 'instagram' } },
    { connection: { ...context.connection, id: 'foreign' } },
  ])('rejects inconsistent ownership before reading any data: %j', async patch => {
    const f = database();
    const args = { ...context, ...patch } as typeof context;
    expect(followUpContextMatches(args)).toBe(false);
    expect(await followUpBlockReason(f.db, args)).toBe('context_mismatch');
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([null, {}, { opted_out: null }, { opted_out: 'false' }])('fails closed on missing or invalid consent: %j', async row => {
    expect(await followUpBlockReason(database(row).db, context)).toBe('contact_unavailable');
  });
  it('blocks a revoked consent and errors without exposing database details', async () => {
    expect(await followUpBlockReason(database({ opted_out: true }).db, context)).toBe('opted_out');
    expect(await followUpBlockReason(database(undefined, undefined, 'contacts').db, context)).toBe('contact_unavailable');
    expect(await followUpBlockReason(database(undefined, undefined, 'conversations').db, context)).toBe('conversation_unavailable');
    expect(await followUpBlockReason(database(undefined, null).db, context)).toBe('conversation_unavailable');
  });
  it.each([
    { status: 'closed' }, { ai_enabled: false }, { deleted_at: '2026-10-01T12:01:00Z' }, { assigned_agent_id: 'human' },
  ])('blocks an ineligible conversation: %j', async patch => {
    expect(await followUpBlockReason(database(undefined, { ...context.conversation, ...patch }).db, context)).toBe('conversation_ineligible');
  });
  it.each([
    { last_sender_type: 'customer' }, { last_message_at: '2026-10-01T12:01:00Z' },
    { last_message_at: null }, { last_message_at: 'invalid' },
    { last_message_at: '2026-10-01T12:00:00.000001Z' },
    { followup_count: 1 }, { followup_last_at: '2026-10-01T12:01:00Z' },
    { channel: 'instagram' }, { connection_id: 'foreign' }, { connection_id: null },
  ])('discards stale candidates: %j', async patch => {
    expect(await followUpBlockReason(database(undefined, { ...context.conversation, ...patch }).db, context)).toBe('conversation_changed');
  });
  it('honors the existing assignment override and equivalent timestamp formats', async () => {
    const args = { ...context, agent: { ...context.agent, reply_when_assigned: true } };
    expect(await followUpBlockReason(database(undefined, { ...context.conversation, assigned_agent_id: 'human', last_message_at: '2026-10-01T12:00:00.000+00:00' }).db, args)).toBeNull();
  });
  it('keeps historical conversations without an owning connection compatible with the scoped fallback', async () => {
    const conversation = { ...context.conversation, connection_id: undefined };
    expect(await followUpBlockReason(database(undefined, conversation).db, { ...context, conversation })).toBeNull();
  });
});
