import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/lib/ai/platform-key', () => ({ resolveAnthropicKey: m.resolve }));
import { byokReadiness } from './byok-readiness';
function database(agentId: string | null = 'agent-own') {
  const q = { eq: () => q, is: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: agentId ? { id: agentId } : null, error: null }) };
  return { from: vi.fn(() => ({ select: () => q })) };
}
beforeEach(() => vi.clearAllMocks());
it.each(['saldo', 'oficial'] as const)('does not request keys for %s', async model => {
  expect(await byokReadiness({} as SupabaseClient, 'ws', model)).toBeNull();
  expect(m.resolve).not.toHaveBeenCalled();
});
it('recognizes a previously saved merchant key without exposing it', async () => {
  m.resolve.mockResolvedValue({ source: 'agent', key: 'private-secret' });
  expect(await byokReadiness({} as SupabaseClient, 'ws', 'byok')).toEqual({ needsKey: false, agentId: null });
});
it.each([null, 'agent-own'])('links an unconfigured BYOK merchant to their own editor (%s)', async agentId => {
  m.resolve.mockResolvedValue(null);
  const db = database(agentId);
  expect(await byokReadiness(db as unknown as SupabaseClient, 'ws', 'byok')).toEqual({ needsKey: true, agentId });
});
it('never mistakes a Riverz platform key for a merchant key', async () => {
  m.resolve.mockResolvedValue({ source: 'platform', key: 'platform-secret' });
  expect((await byokReadiness(database() as unknown as SupabaseClient, 'ws', 'byok'))?.needsKey).toBe(true);
});
