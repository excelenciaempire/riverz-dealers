import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { purchaseNumber, reconcileNumbers, type NumberSubscription } from './number-billing';
import { orderNumber, findNumberOrder, findOwnedNumber, releaseNumber, TelnyxApiError } from './telnyx-numbers';
import { writeVoiceConfig } from './voice-connection-store';
import { cancelar } from '@/lib/wallet/operacion';
vi.mock('./telnyx-numbers', async (original) => ({ ...await original<typeof import('./telnyx-numbers')>(), orderNumber: vi.fn(), findNumberOrder: vi.fn(), findOwnedNumber: vi.fn(), releaseNumber: vi.fn() }));
vi.mock('./voice-connection-store', () => ({ readVoiceConfig: vi.fn(async () => ({ id: 'connection', config: { recording_enabled: true } })), writeVoiceConfig: vi.fn() }));
vi.mock('@/lib/wallet/operacion', () => ({ cancelar: vi.fn() }));
let row: NumberSubscription;
let reserveAllowed = true;
const rpc = vi.fn(async (name: string) => ({ data: name === 'voice_number_claim' ? row.id : name === 'voice_number_reserve' ? reserveAllowed : true, error: null }));
const db = {
  rpc,
  from: () => {
    let patch: Record<string, unknown> | undefined;
    const builder = {
      select: () => builder, not: () => builder, lt: () => builder, order: () => builder,
      eq: () => builder,
      update: (values: Record<string, unknown>) => { patch = values; return builder; },
      limit: async () => ({ data: [{ ...row }], error: null }),
      maybeSingle: async () => ({ data: { ...row }, error: null }),
      then: (resolve: (r: unknown) => void) => { if (patch) Object.assign(row, patch); resolve({ error: null }); },
    };
    return builder;
  },
} as unknown as SupabaseClient;
const quote = { workspace: 'workspace', phone: '+576019191270', country: 'CO', type: 'local' as const, upfront: 1350, monthly: 1350, expires: Date.now() + 100000 };
beforeEach(() => {
  vi.clearAllMocks(); reserveAllowed = true;
  row = { id: 'subscription', workspace_id: 'workspace', phone_number: quote.phone, country: 'CO', status: 'purchasing', order_id: null, number_id: null, upfront_cents: 1350, monthly_cents: 1350, next_renewal_at: null, renewal_operation: null, created_at: '2026-09-13T01:00:00Z' };
});
describe('number provisioning failures and renewal boundaries', () => {
  it('blocks carrier purchases if billing has not been installed', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing function' } } as never);
    await expect(purchaseNumber(db, quote, 'owner')).rejects.toThrow('number_billing_unavailable');
    expect(orderNumber).not.toHaveBeenCalled();
  });
  it('refunds an explicit rejection and leaves no usable number', async () => {
    vi.mocked(orderNumber).mockRejectedValueOnce(new TelnyxApiError('Insufficient funds', 402, '20100', null));
    await expect(purchaseNumber(db, quote, 'owner')).rejects.toThrow();
    expect(cancelar).toHaveBeenCalledOnce();
    expect(row.status).toBe('failed');
    expect(writeVoiceConfig).not.toHaveBeenCalled();
  });
  it('retains the hold after network uncertainty and does not retry the purchase', async () => {
    vi.mocked(orderNumber).mockRejectedValueOnce(new Error('timeout'));
    await expect(purchaseNumber(db, quote, 'owner')).rejects.toThrow();
    expect(cancelar).not.toHaveBeenCalled();
    expect(row.status).toBe('purchasing');
    expect(orderNumber).toHaveBeenCalledOnce();
  });
  it('charges an accepted pending order without enabling calls', async () => {
    vi.mocked(orderNumber).mockResolvedValueOnce({ id: 'order', phone_number: quote.phone, status: 'pending' });
    await purchaseNumber(db, quote, 'owner');
    expect(row.status).toBe('pending');
    expect(rpc).toHaveBeenCalledWith('voice_number_settle', expect.anything());
    expect(writeVoiceConfig).not.toHaveBeenCalled();
  });
  it('recovers a lost response and attaches the real number ID only after activation', async () => {
    vi.mocked(findNumberOrder).mockResolvedValueOnce({ id: 'order', phone_number: quote.phone, status: 'success' });
    vi.mocked(findOwnedNumber).mockResolvedValue({ id: 'actual-number-id', status: 'active' });
    await reconcileNumbers(db, new Date('2026-09-14T00:00:00Z'));
    expect(orderNumber).not.toHaveBeenCalled();
    expect(writeVoiceConfig).toHaveBeenCalledWith('workspace', 'connection', expect.objectContaining({ telnyx_number_id: 'actual-number-id', recording_enabled: true }), 'connected');
  });
  it('reserves the next month early, but does not charge it before it starts', async () => {
    row.status = 'active'; row.next_renewal_at = '2026-10-01T00:00:00.000Z';
    await reconcileNumbers(db, new Date('2026-09-25T00:00:00Z'));
    expect(rpc).toHaveBeenCalledWith('voice_number_reserve', expect.objectContaining({ p_cents: 1350 }));
    expect(rpc.mock.calls.some(([name]) => name === 'voice_number_settle')).toBe(false);
    expect(releaseNumber).not.toHaveBeenCalled();
  });
  it('releases only at the disclosed cutoff when the next month cannot be funded', async () => {
    row.status = 'active'; row.next_renewal_at = '2026-10-01T00:00:00.000Z'; reserveAllowed = false;
    await reconcileNumbers(db, new Date('2026-09-28T00:00:00Z'));
    expect(releaseNumber).not.toHaveBeenCalled();
    vi.mocked(findOwnedNumber).mockResolvedValue({ id: 'actual-number-id', status: 'active' });
    await reconcileNumbers(db, new Date('2026-09-30T01:00:00Z'));
    expect(releaseNumber).toHaveBeenCalledWith('actual-number-id');
    expect(row.status).toBe('released');
  });
});
