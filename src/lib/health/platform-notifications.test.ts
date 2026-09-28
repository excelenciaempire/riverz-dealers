import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverPlatformNotifications, type WatchState } from './platform-notifications';

const key = 'saldo:fish:bajo';
function setup() {
  const writes: Array<Record<string, unknown>> = [];
  let fail = false;
  const db = { from: () => ({ update: (body: Record<string, unknown>) => {
    writes.push(structuredClone(body));
    const q = { eq: () => q, select: async () => ({ data: fail ? null : [{ id: true }], error: fail ? {} : null }) };
    return q;
  } }) } as unknown as SupabaseClient;
  const args = {
    db, state: { fingerprint: '', alert_history: {}, pending_notifications: [], notification_lease_id: 'lease' } as WatchState,
    fingerprint: key, history: {}, newKeys: [key], lines: new Map([[key, 'Fish low']]),
    whatsappTitle: 'Alert', emailTitle: 'Riverz Alert', recipients: { phone: 'owner', email: 'owner@example.test' },
    sendWhatsApp: vi.fn().mockResolvedValue(true), sendEmail: vi.fn().mockResolvedValue(true), now: 1_000_000,
  };
  return { args, writes, failWrite: () => { fail = true; } };
}
describe('durable owner notification delivery', () => {
  it('saves the outbox before any send and acknowledges both channels independently', async () => {
    const { args, writes } = setup();
    args.sendWhatsApp.mockImplementation(async () => { expect(writes[0].pending_notifications).toHaveLength(2); return true; });
    const result = await deliverPlatformNotifications(args);
    expect(result).toEqual({ via: ['whatsapp', 'correo'], pending: 0, whatsappPending: 0 });
    expect(writes.at(-1)?.pending_notifications).toEqual([]);
  });
  it('does not discard WhatsApp when email succeeds; retries even with unchanged fingerprint', async () => {
    const { args, writes } = setup(); args.sendWhatsApp.mockResolvedValue(false);
    expect((await deliverPlatformNotifications(args)).whatsappPending).toBe(1);
    const persisted = writes.at(-1)!;
    args.state = { ...args.state, ...persisted } as WatchState;
    args.newKeys = []; args.now += 15 * 60_000; args.sendWhatsApp.mockResolvedValue(true);
    args.sendEmail.mockClear();
    expect((await deliverPlatformNotifications(args)).pending).toBe(0);
    expect(args.sendEmail).not.toHaveBeenCalled();
  });
  it('does not send until the durable save succeeds', async () => {
    const { args, failWrite } = setup(); failWrite();
    await expect(deliverPlatformNotifications(args)).rejects.toThrow('snapshot_failed');
    expect(args.sendWhatsApp).not.toHaveBeenCalled(); expect(args.sendEmail).not.toHaveBeenCalled();
  });
  it('backs off repeated WhatsApp failures instead of sending every page view', async () => {
    const { args, writes } = setup(); args.sendWhatsApp.mockRejectedValue(new Error('outage'));
    await deliverPlatformNotifications(args);
    args.state = { ...args.state, ...writes.at(-1) } as WatchState;
    args.newKeys = []; args.now += 60_000; args.sendWhatsApp.mockClear();
    expect((await deliverPlatformNotifications(args)).whatsappPending).toBe(1);
    expect(args.sendWhatsApp).not.toHaveBeenCalled();
  });
  it('retains a WhatsApp notification when no administrator destination is configured', async () => {
    const { args, writes } = setup(); args.recipients.phone = null as unknown as string;
    expect((await deliverPlatformNotifications(args)).whatsappPending).toBe(1);
    expect(writes.at(-1)?.pending_notifications).toHaveLength(1);
  });
  it('drops unsent notifications for recovered incidents without sending obsolete warnings', async () => {
    const { args, writes } = setup(); args.sendWhatsApp.mockResolvedValue(false);
    await deliverPlatformNotifications(args);
    args.state = { ...args.state, ...writes.at(-1) } as WatchState;
    args.fingerprint = ''; args.newKeys = []; args.now += 15 * 60_000; args.sendWhatsApp.mockClear();
    expect((await deliverPlatformNotifications(args)).pending).toBe(0);
    expect(args.sendWhatsApp).not.toHaveBeenCalled();
  });
  it('does not change notified_at on a failed send', async () => {
    const { args, writes } = setup(); args.recipients.email = null as unknown as string; args.sendWhatsApp.mockResolvedValue(false);
    await deliverPlatformNotifications(args);
    expect(writes.every((write) => !Object.hasOwn(write, 'notified_at'))).toBe(true);
  });
});
