import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { INBOX_CAPABILITIES } from './inbox';
import type { CapabilityContext } from './types';
const WS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWN = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '44444444-4444-4444-8444-444444444444';
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>, errors: Set<string>, writes: string[], executed: string[], filters: Array<[string, string, unknown]>;
function database(): SupabaseClient {
  return { from: (table: string) => {
    const predicates: Array<(row: Row) => boolean> = []; let count = Infinity;
    const result = () => { executed.push(table); return { data: (rows[table] ?? []).filter(row => predicates.every(test => test(row))).slice(0, count), error: errors.has(table) ? { message: 'private SQL details' } : null }; };
    const q = { select: () => q, order: () => q, limit: (n: number) => { count = n; return q; },
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); predicates.push(row => row[key] === value); return q; },
      is: (key: string, value: unknown) => { predicates.push(row => (row[key] ?? null) === value); return q; },
      in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return q; },
      not: (key: string, operator: string, value: string) => { expect(operator).toBe('in'); const excluded = value.slice(1, -1).split(','); predicates.push(row => !excluded.includes(String(row[key]))); return q; },
      or: (value: string) => {
        const own = /connection_id\.in\.\(([^)]*)\)/.exec(value)?.[1].split(',') ?? [];
        predicates.push(row => !['gmail', 'outlook', 'zoho'].includes(String(row.channel)) || own.includes(String(row.connection_id))); return q;
      },
      update: () => { writes.push(table); return q; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    }; return q;
  }, rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient;
}
function context(mcp = false): CapabilityContext {
  return { db: database(), workspaceId: WS, locale: 'en', actor: mcp ? { type: 'mcp', id: 'key-label', userId: 'owner' } : { type: 'operator', id: 'owner' } };
}
const capability = (key: string) => INBOX_CAPABILITIES.find(item => item.key === key)!;
beforeEach(() => {
  errors = new Set(); writes = []; executed = []; filters = [];
  rows = { channel_connections: [
    { id: OWN, workspace_id: WS, created_by: 'owner', channel: 'gmail' },
    { id: FOREIGN, workspace_id: WS, created_by: 'other-user', channel: 'gmail' },
    { id: OTHER, workspace_id: OTHER, created_by: 'owner', channel: 'gmail' },
  ], conversations: [
    { id: 'shared', workspace_id: WS, channel: 'whatsapp', contacts: { name: 'Shared customer' } },
    { id: 'own-mail', workspace_id: WS, channel: 'gmail', connection_id: OWN, contacts: { name: 'Own mailbox customer' } },
    { id: 'private-mail', workspace_id: WS, channel: 'gmail', connection_id: FOREIGN, contacts: { name: 'Private other mailbox' }, last_message_text: 'Private other contents' },
    { id: 'foreign-business', workspace_id: OTHER, channel: 'gmail', connection_id: OTHER, contacts: { name: 'Foreign business contents' } },
  ], messages: [{ id: 'message', conversation_id: 'own-mail', content_text: 'Own mail body', sender_type: 'customer', created_at: new Date().toISOString() }] };
});

describe('inbox capabilities respect the personal mailbox owner', () => {
  it.each([false, true])('filters owned mail before returning the conversation search for MCP=%s', async mcp => {
    const result = await capability('conversaciones.buscar').run(context(mcp), {});
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('Own mailbox customer'); expect(serialized).toContain('Shared customer');
    expect(serialized).not.toMatch(/Private other|Foreign business/);
    expect(filters).toContainEqual(['channel_connections', 'workspace_id', WS]); expect(filters).toContainEqual(['channel_connections', 'created_by', 'owner']);
  });
  it('does not use a caller label or tool argument as the mailbox owner', async () => {
    const ctx = context(true); ctx.actor = { type: 'mcp', id: 'owner' };
    const result = await capability('conversaciones.buscar').run(ctx, { user_id: 'owner', actor_user_id: 'owner' });
    expect(JSON.stringify(result)).toContain('Shared customer'); expect(JSON.stringify(result)).not.toContain('Own mailbox customer');
    expect(executed).not.toContain('channel_connections');
  });
  it('applies mailbox visibility before the search limit so private rows cannot hide an owned result', async () => {
    const hidden = rows.conversations[2];
    rows.conversations = [...Array.from({ length: 60 }, (_, i) => ({ ...hidden, id: `hidden-${i}` })), ...rows.conversations];
    const result = await capability('conversaciones.buscar').run(context(), { canal: 'gmail', limite: 1 });
    expect(JSON.stringify(result)).toContain('Own mailbox customer');
    expect(JSON.stringify(result)).not.toContain('Private other');
  });
  it.each(['gmail', 'outlook', 'zoho'])('allows only the actual owner of a %s detail or transcript', async channel => {
    for (const row of rows.channel_connections) row.channel = channel;
    for (const row of rows.conversations) if (row.channel === 'gmail') row.channel = channel;
    for (const key of ['conversaciones.detalle', 'conversaciones.mensajes']) {
      await expect(capability(key).run(context(true), { conversacion_id: 'own-mail' })).resolves.toBeDefined();
      executed = [];
      await expect(capability(key).run(context(true), { conversacion_id: 'private-mail' })).rejects.toThrow();
      expect(executed).not.toContain('messages'); expect(executed).not.toContain('ai_replies');
      expect(filters).toContainEqual(['channel_connections', 'workspace_id', WS]); expect(filters).toContainEqual(['channel_connections', 'channel', channel]);
    }
  });
  it.each(['conversaciones.cerrar', 'conversaciones.ia', 'conversaciones.asignar'])('blocks %s and its preview for someone else’s mailbox before writes', async key => {
    const args = { conversacion_id: 'private-mail', activa: false, miembro: '' };
    await expect(capability(key).run(context(), args)).rejects.toThrow();
    await expect(capability(key).preview!(context(), args)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
  it('does not read a private transcript when the actor or connection is absent', async () => {
    const ctx = context(true); ctx.actor.userId = null;
    await expect(capability('conversaciones.mensajes').run(ctx, { conversacion_id: 'own-mail' })).rejects.toThrow();
    rows.conversations[1].connection_id = null;
    await expect(capability('conversaciones.mensajes').run(context(), { conversacion_id: 'own-mail' })).rejects.toThrow();
    expect(executed).not.toContain('messages');
  });
  it('rechecks current ownership rather than retaining permissions from an earlier request', async () => {
    const ctx = context();
    await expect(capability('conversaciones.detalle').run(ctx, { conversacion_id: 'own-mail' })).resolves.toBeDefined();
    rows.channel_connections[0].created_by = 'other-user'; executed = [];
    await expect(capability('conversaciones.detalle').run(ctx, { conversacion_id: 'own-mail' })).rejects.toThrow();
    expect(executed).not.toContain('ai_replies');
  });
  it('does not accept a connection owned by the user in another business or for another channel', async () => {
    rows.channel_connections[0].workspace_id = OTHER;
    await expect(capability('conversaciones.detalle').run(context(), { conversacion_id: 'own-mail' })).rejects.toThrow();
    rows.channel_connections[0].workspace_id = WS; rows.channel_connections[0].channel = 'zoho';
    await expect(capability('conversaciones.detalle').run(context(), { conversacion_id: 'own-mail' })).rejects.toThrow();
  });
  it('does not turn a failed owner lookup into an empty search or expose its SQL detail', async () => {
    errors.add('channel_connections');
    await expect(capability('conversaciones.buscar').run(context(), {})).rejects.not.toThrow('private SQL details');
    await expect(capability('conversaciones.detalle').run(context(), { conversacion_id: 'own-mail' })).rejects.not.toThrow('private SQL details');
    expect(executed).not.toContain('messages'); expect(executed).not.toContain('ai_replies');
  });
  it('preserves shared-channel searches without consulting mailboxes when the channel is explicit', async () => {
    errors.add('channel_connections');
    const result = await capability('conversaciones.buscar').run(context(true), { canal: 'whatsapp' });
    expect(JSON.stringify(result)).toContain('Shared customer'); expect(executed).not.toContain('channel_connections');
  });
});
