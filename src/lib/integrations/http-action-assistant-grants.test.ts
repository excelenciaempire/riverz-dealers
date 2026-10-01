import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { manageHttpAssistantGrant } from './http-action-assistant-grants';
const WS = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333', AGENT = '44444444-4444-4444-8444-444444444444';
const row = () => ({ agent_id: AGENT, channel: 'whatsapp', context_scope: 'contact', action_revision: 2, revision: 1,
  state: 'active', granted_by: ACTOR, updated_at: '2026-10-01T00:00:00Z' });
const input = () => ({ agent_id: AGENT, channel: 'whatsapp', context_scope: 'contact', action_revision: 2, expected_version: 0 });
let rpc = vi.fn();
const db = () => ({ rpc } as unknown as SupabaseClient);
beforeEach(() => { rpc = vi.fn().mockResolvedValue({ data: row(), error: null }); });
describe('assistant HTTP grant configuration store', () => {
  it('passes only protected server scope and strict declared grant fields', async () => {
    expect(await manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'save', input())).toEqual(row());
    expect(rpc).toHaveBeenCalledWith('manage_http_action_assistant_grant', { p_workspace_id: WS, p_actor_id: ACTOR, p_action_id: ACTION,
      p_operation: 'save', p_agent_id: AGENT, p_channel: 'whatsapp', p_grant_revision: 0, p_context_scope: 'contact', p_action_revision: 2 });
  });
  it.each(['actor_id', 'workspace_id', 'granted_by', 'confirmed', 'secret', 'url'])('rejects an extra authority/configuration field %s', async key => {
    await expect(manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'save', { ...input(), [key]: 'FORGED' })).rejects.toThrow('http_grant_invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('withdraws without requiring a current action revision or credential', async () => {
    rpc.mockResolvedValue({ data: { ...row(), state: 'withdrawn', revision: 2 }, error: null });
    await manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'withdraw', { agent_id: AGENT, channel: 'whatsapp', expected_version: 1 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_context_scope: null, p_action_revision: null });
  });
  it('requires confirmed list shape and never converts failure to an empty catalog', async () => {
    rpc.mockResolvedValue({ data: { grants: [row()] }, error: null });
    expect(await manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'list')).toEqual({ grants: [row()] });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'list')).rejects.toThrow('http_grant_unavailable');
  });
  it.each(['agent', 'version', 'scope', 'actor', 'extra'])('rejects mismatched saved %s metadata', async mode => {
    const altered = { ...row(), ...(mode === 'agent' ? { agent_id: WS } : mode === 'version' ? { revision: 99 }
      : mode === 'scope' ? { context_scope: 'business' } : mode === 'actor' ? { granted_by: WS } : { secret: 'PRIVATE' }) };
    rpc.mockResolvedValue({ data: altered, error: null });
    await expect(manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'save', input())).rejects.toThrow('http_grant_unavailable');
  });
  it.each([['http_grant_changed', 'changed'], ['http_grant_identity_required', 'identity_required'], ['http_grant_admin_required', 'forbidden'],
    ['subscription_read_only', 'read_only'], ['PRIVATE_SQL_ERROR', 'unavailable']])('bounds database failure %s', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'list')).rejects.toThrow(`http_grant_${code}`);
  });
  it('sanitizes rejected RPC promises', async () => {
    rpc.mockRejectedValue(new Error('PRIVATE_DATABASE_ERROR'));
    await expect(manageHttpAssistantGrant(db(), WS, ACTOR, ACTION, 'list')).rejects.toThrow('http_grant_unavailable');
  });
});
