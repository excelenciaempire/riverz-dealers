import { describe, it, expect, vi } from 'vitest';
import { demoData } from '@/lib/dealers/demo';
import type { CapabilityContext } from './types';
const h = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/dealers/server', () => ({ readDealerData: h.read }));
import { DEALER_CAPABILITIES } from './dealers';
import { dealerOperatorContext } from '@/lib/dealers/operator-context';
describe('dealer operator evidence', () => {
  it('uses the protected workspace and the same cohort as the BDC interface', async () => {
    h.read.mockResolvedValue(demoData());
    const ctx = {
      db: {},
      workspaceId: 'protected',
      actor: { type: 'operator' },
    } as CapabilityContext;
    const result = (await DEALER_CAPABILITIES[0].run(ctx, {
      workspace_id: 'attacker',
    })) as { metrics: { leads: number } };
    expect(h.read).toHaveBeenCalledWith(ctx.db, 'protected', '');
    expect(result.metrics.leads).toBe(demoData().opportunities.length);
    expect(DEALER_CAPABILITIES[0].risk).toBe('lectura');
  });
  it('adapts the seller operator without changing ecommerce instructions', () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    expect(dealerOperatorContext()).toContain('dealers.estado');
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'ecommerce');
    expect(dealerOperatorContext()).toBe('');
    vi.unstubAllEnvs();
  });
});
