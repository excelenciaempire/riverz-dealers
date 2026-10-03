import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRetiredDealerRoute } from './product-scope';
import { isDealerDeployment } from './config';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('Dealers product boundaries', () => {
  it('retires old pages in both languages and nested commerce APIs without blocking buyer tools', () => {
    for (const path of [
      '/menus',
      '/flows/old/edit',
      '/productos/old',
      '/products/old',
      '/orders/',
      '/returns',
      '/logistics',
      '/shopify/embedded',
      '/api/flows/old/activate',
      '/api/products/old',
      '/api/contacts/buyer/commerce-link',
      '/api/conversations/chat/orders/id/execute',
      '/api/ai/cobro-comprobante',
      '/api/automations/tablero',
      '/api/cron/contacts-sync',
    ]) {
      expect(isRetiredDealerRoute(path), path).toBe(true);
    }
    for (const path of [
      '/concesionario',
      '/dealer',
      '/asistente',
      '/ai',
      '/automations',
      '/api/dealers/opportunities/id',
      '/api/contacts/buyer',
      '/api/conversations/chat/messages',
      '/api/billing/checkout',
      '/api/orders-preview',
    ]) {
      expect(isRetiredDealerRoute(path), path).toBe(false);
    }
  });
  it('cannot reopen ecommerce in a production deployment through an environment toggle', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'ecommerce');
    expect(isDealerDeployment()).toBe(true);
  });
  it('rejects retired triggers and commerce branches while accepting appointment follow-up', () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    expect(validateTriggerForActivation('shopify_order_created', {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'dealers.dealerOnlyAutomation' }),
      ])
    );
    expect(
      validateTriggerForActivation('dealer_appointment_reminder', {})
    ).toEqual([]);
    for (const step of [
      { step_type: 'condition', step_config: { subject: 'order_paid' } },
      {
        step_type: 'condition',
        step_config: {
          subject: 'contact_field',
          operand: 'last_product',
          value: 'item',
        },
      },
      {
        step_type: 'set_context',
        step_config: { values: { checkout_url: 'https://example.com' } },
      },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'legacy',
          variables: { '1': '{{vars.order_name}}' },
        },
      },
    ]) {
      expect(validateStepsForActivation([step])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'dealers.dealerOnlyAutomation' }),
        ])
      );
    }
    expect(
      validateStepsForActivation([
        {
          step_type: 'send_template',
          step_config: {
            template_name: 'visit_reminder',
            variables: {
              '1': '{{vars.customer_name}}',
              '2': '{{vars.vehicle}}',
              '3': '{{vars.appointment_at}}',
            },
          },
        },
      ])
    ).toEqual([]);
  });
  it('offers buyer and appointment variables and no checkout buttons or retired scheduled jobs', async () => {
    vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL', 'dealers');
    const { allTemplateDataPoints, conditionDataPoints, DATA_POINTS } =
      await import('@/lib/automations/data-points');
    expect(allTemplateDataPoints().map((d) => d.templateVarKey)).toEqual(
      expect.arrayContaining([
        'vehicle',
        'appointment_at',
        'appointment_location',
        'customer_name',
      ])
    );
    expect(
      conditionDataPoints('dealer_appointment_reminder').map((d) => d.id)
    ).toContain('dealer_vehicle');
    expect(
      DATA_POINTS.some((d) =>
        ['last_product', 'order_paid', 'checkout_url', 'total_price'].includes(
          d.id
        )
      )
    ).toBe(false);
    const { BUTTON_URL_VARIABLES, isButtonUrlVariable } =
      await import('@/lib/whatsapp/dynamic-links');
    expect(BUTTON_URL_VARIABLES).toEqual([]);
    expect(isButtonUrlVariable('checkout_url')).toBe(false);
    const { SCHEDULED_JOBS } = await import('@/lib/cron/schedule');
    expect(SCHEDULED_JOBS.map((job) => job.path)).toContain(
      '/api/automations/cron'
    );
    expect(
      SCHEDULED_JOBS.filter((job) => isRetiredDealerRoute(job.path))
    ).toEqual([]);
    const { AI_TRIGGERS } = await import('@/lib/automations/ai-steps');
    expect(AI_TRIGGERS.map((t) => t.value)).toContain(
      'dealer_appointment_reminder'
    );
    expect(
      AI_TRIGGERS.some(
        (t) => t.value.startsWith('shopify_') || t.value === 'payment_pending'
      )
    ).toBe(false);
    const { isFeatureEnabled } = await import('@/lib/admin/feature-flags');
    expect(isFeatureEnabled({ flows: true, orders: true }, 'flows')).toBe(
      false
    );
    expect(isFeatureEnabled({ flows: true, orders: true }, 'orders')).toBe(
      false
    );
  });
});
