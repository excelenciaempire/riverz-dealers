import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '@/types';
vi.mock('./cooldown', () => ({ recentlyContacted: async () => ({ blocked: false }) }));
vi.mock('@/lib/whatsapp/tier-cap', () => ({ resolveWhatsAppConnectionId: async () => null, assertWithinTierCap: vi.fn() }));
import { checkSendGate } from './send-gate';
function db(optedOut = false) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { opted_out: optedOut, last_inbound_at: '2000-01-01T00:00:00Z' } }) };
  return { from: () => q } as unknown as SupabaseClient;
}
describe('channel-specific outreach guards', () => {
  it.each(['gmail', 'outlook', 'zoho', 'webchat'] as Channel[])('does not apply a Meta window to %s', async channel => {
    expect(await checkSendGate({ db: db(), workspaceId: 'workspace', contactId: 'contact', kind: 'text', reason: 'asistente', channel })).toEqual({ allow: true });
  });
  it.each(['whatsapp', 'instagram', 'messenger', undefined] as const)('keeps the 24h window for %s including legacy callers', async channel => {
    expect(await checkSendGate({ db: db(), workspaceId: 'workspace', contactId: 'contact', kind: 'text', reason: 'asistente', channel })).toMatchObject({ allow: false, barrier: 'ventana_24h' });
  });
  it.each(['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat'] as Channel[])('honors opt-out on %s', async channel => {
    expect(await checkSendGate({ db: db(true), workspaceId: 'workspace', contactId: 'contact', kind: 'text', reason: 'asistente', channel })).toMatchObject({ allow: false, barrier: 'baja' });
  });
});
