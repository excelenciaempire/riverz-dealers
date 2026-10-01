import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { httpAssistantGrantChoices } from './http-action-grant-catalog';
const WS = '11111111-1111-4111-8111-111111111111', AGENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
let profiles: unknown[], channels: unknown[], filters: Array<[string, string, unknown]>, error: unknown;
function db(): SupabaseClient {
  return { from(table: string) {
    let selection = '';
    const q = { select: (value: string) => { selection = value; return q; }, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([table, key, value]); return q; }, in: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      order: () => q, limit: () => q, then: (done: (value: unknown) => unknown) => Promise.resolve({ error,
        data: (table === 'ai_agents' ? profiles : channels).map(row => row && typeof row === 'object'
          ? Object.fromEntries(selection.split(',').map(key => [key.trim(), (row as Record<string, unknown>)[key.trim()]])) : row) }).then(done) };
    return q;
  } } as unknown as SupabaseClient;
}
beforeEach(() => {
  profiles = [{ id: AGENT, workspace_id: WS, name: 'Existing assistant', is_active: true, scope: 'workspace', api_key: 'PRIVATE_KEY', prompt: 'PRIVATE_PROMPT' }];
  channels = []; filters = []; error = null;
});
describe('private bounded assistant choices for HTTP grants', () => {
  it('returns current profile metadata only with compatible private channels and scoped filters', async () => {
    const choices = await httpAssistantGrantChoices(db(), WS);
    expect(choices).toEqual([{ id: AGENT, name: 'Existing assistant', is_active: true, channels: ['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat'] }]);
    expect(JSON.stringify(choices)).not.toMatch(/PRIVATE|workspace_id|api_key|prompt/);
    expect(filters).toContainEqual(['ai_agents', 'workspace_id', WS]); expect(filters).toContainEqual(['ai_agents', 'deleted_at', null]);
    expect(filters).toContainEqual(['ai_agent_channels', 'agent_id', [AGENT]]);
  });
  it('shows paused profiles without activating them and only their compatible assigned channels', async () => {
    profiles = [{ ...(profiles[0] as object), scope: 'channels', is_active: false }];
    channels = [{ agent_id: AGENT, channel: 'gmail' }, { agent_id: AGENT, channel: 'whatsapp' }, { agent_id: AGENT, channel: 'ig_comment' }, { agent_id: AGENT, channel: 'mercadolibre' }];
    expect(await httpAssistantGrantChoices(db(), WS)).toMatchObject([{ is_active: false, channels: ['whatsapp', 'gmail'] }]);
  });
  it('does not silently truncate oversized or malformed profile catalogs', async () => {
    const original = profiles[0]; profiles = Array.from({ length: 101 }, () => original);
    await expect(httpAssistantGrantChoices(db(), WS)).rejects.toThrow('http_grant_limit');
    profiles = [{ ...(original as object), workspace_id: OTHER }]; await expect(httpAssistantGrantChoices(db(), WS)).rejects.toThrow('http_grant_unavailable');
    profiles = [original, original]; await expect(httpAssistantGrantChoices(db(), WS)).rejects.toThrow('http_grant_unavailable');
  });
  it('rejects assignments outside the selected profile IDs and sanitizes database failures', async () => {
    channels = [{ agent_id: OTHER, channel: 'whatsapp' }]; await expect(httpAssistantGrantChoices(db(), WS)).rejects.toThrow('http_grant_unavailable');
    channels = []; error = { message: 'PRIVATE_DB' }; await expect(httpAssistantGrantChoices(db(), WS)).rejects.toThrow('http_grant_unavailable');
  });
  it('keeps an empty catalog complete without reading unrelated channel assignments', async () => {
    profiles = []; expect(await httpAssistantGrantChoices(db(), WS)).toEqual([]);
    expect(filters.some(([table]) => table === 'ai_agent_channels')).toBe(false);
  });
});
