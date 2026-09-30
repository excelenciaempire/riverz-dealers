import { describe, expect, it, vi } from 'vitest';
import { isBusinessMutation, workspaceReadOnly, assertWorkspaceWritable } from './read-only';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('billing read-only boundary', () => {
  it.each(['/api/messages/send','/api/messages/moderate','/api/ai/agents','/api/conversations/c/collaboration','/api/products','/asistente'])('blocks business changes and server actions at %s', path => {
    expect(isBusinessMutation(path,'POST')).toBe(true);
    expect(isBusinessMutation(path,'PATCH')).toBe(path.startsWith('/api/'));
  });
  it.each(['/api/billing/webhook','/api/billing/checkout','/api/cron/wallet-conciliacion','/api/whatsapp/webhook','/api/channels/instagram/webhook','/api/widget/messages','/api/conversations/c/sync','/api/wallet/tarjeta','/api/mcp','/api/auth/login'])('keeps receipt, reads and recovery open at %s', path => {
    expect(isBusinessMutation(path,'POST')).toBe(false);
  });
  it('does not mistake a business route containing webhook text for an inbound hook', () => {
    expect(isBusinessMutation('/api/integrations/webhooks/a/test','POST')).toBe(true);
    expect(isBusinessMutation('/api/messages/send?webhook=yes','POST')).toBe(true);
    expect(isBusinessMutation('/api/conversations/c','GET')).toBe(false);
    expect(isBusinessMutation('/api/connections/meta/oauth/start','GET')).toBe(true);
  });
  it('fails closed on missing financial state and restores writes after verified payment', async () => {
    const rpc=vi.fn().mockResolvedValueOnce({data:false}).mockResolvedValueOnce({data:true}).mockResolvedValueOnce({error:{message:'unavailable'}});
    const db={rpc} as unknown as SupabaseClient;
    await expect(assertWorkspaceWritable(db,'w')).rejects.toMatchObject({code:'subscription_read_only'});
    await expect(workspaceReadOnly(db,'w')).resolves.toBe(false);
    await expect(workspaceReadOnly(db,'w')).rejects.toThrow('subscription_payment_state_unavailable');
  });
});
