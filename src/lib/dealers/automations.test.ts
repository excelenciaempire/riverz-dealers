import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertDealerAutomationAllowed,
  enqueueDealerAutomations,
} from './automations';
import { getTemplate, listTemplates } from '@/lib/automations/templates';
import { validateStepsForActivation } from '@/lib/automations/validate';
afterEach(() => vi.unstubAllEnvs());
describe('dealer automation integration', () => {
  it('offers localized dealer recipes with an approved template required before activation', () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    expect(listTemplates().map((t) => t.slug)).toEqual([
      'dealer-seguimiento',
      'dealer-recordatorio-cita',
      'dealer-recuperar-ausencia',
      'dealer-despues-visita',
    ]);
    const en = getTemplate('dealer-recordatorio-cita', 'en')!;
    expect(en.steps[0].step_config).toMatchObject({
      language: 'en',
      template_name: '',
    });
    expect(en.suggested_template_body).toContain('look forward');
    for (const recipe of listTemplates('en')) {
      expect(recipe.steps[0].step_config).toMatchObject({
        variables: { '1': '{{vars.customer_name}}' },
      });
    }
    expect(
      validateStepsForActivation(
        en.steps.map((s) => ({
          step_type: s.step_type,
          step_config: { ...s.step_config },
        }))
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'automations.issueSinPlantilla' }),
      ])
    );
    expect(getTemplate('carrito-abandonado')).toBeNull();
  });
  it('keeps ecommerce recipes and skips dealer polling in the original vertical', async () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'ecommerce');
    expect(getTemplate('dealer-seguimiento')).toBeNull();
    expect(getTemplate('carrito-abandonado')).toBeTruthy();
    const rpc = vi.fn();
    expect(
      await enqueueDealerAutomations({ rpc } as unknown as SupabaseClient)
    ).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires a positive live-state check and fixes the workspace and contact at the execution context', async () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const db = { rpc } as unknown as SupabaseClient;
    const vars = { dealer_opportunity_id: 'buyer-opportunity' };
    await expect(
      assertDealerAutomationAllowed(
        db,
        'tenant',
        'buyer',
        'dealer_follow_up_due',
        vars
      )
    ).rejects.toThrow('dealer_follow_up_stopped');
    expect(rpc).toHaveBeenCalledWith('dealer_automation_allowed', {
      p_workspace: 'tenant',
      p_contact: 'buyer',
      p_event: 'dealer_follow_up_due',
      p_vars: vars,
    });
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(
      assertDealerAutomationAllowed(
        db,
        'tenant',
        'buyer',
        'dealer_follow_up_due',
        vars
      )
    ).resolves.toBeUndefined();
    await expect(
      assertDealerAutomationAllowed(
        db,
        'tenant',
        null,
        'dealer_follow_up_due',
        vars
      )
    ).rejects.toThrow();
  });
  it('fails closed on missing schema or database failure while leaving unrelated triggers unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'schema unavailable' },
    });
    const db = { rpc } as unknown as SupabaseClient;
    await expect(enqueueDealerAutomations(db)).rejects.toThrow(
      'schema unavailable'
    );
    await expect(
      assertDealerAutomationAllowed(
        db,
        'tenant',
        'buyer',
        'dealer_appointment_reminder'
      )
    ).rejects.toThrow('schema unavailable');
    await expect(
      assertDealerAutomationAllowed(db, 'tenant', 'buyer', 'tag_added')
    ).resolves.toBeUndefined();
  });
});
