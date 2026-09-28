import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import {
  TRIGGER_OPTIONS,
  triggerLabel,
  activadorSoportado,
} from '@/components/automations/activador';
import { getTemplate, listTemplates } from './templates';
import {
  conditionDataPoints,
  templateDataPoints,
  TEMPLATE_VAR_SAMPLES,
} from './data-points';

describe('Mercado Pago merchant automation catalog', () => {
  it('offers pending and rejected triggers without requiring a store', () => {
    for (const type of ['payment_pending', 'payment_rejected'] as const) {
      expect(TRIGGER_OPTIONS.some((option) => option.value === type)).toBe(
        true
      );
      for (const platform of [
        null,
        'shopify',
        'tiendanube',
        'woocommerce',
      ] as const)
        expect(activadorSoportado(type, platform)).toBe(true);
    }
  });
  for (const locale of ['es', 'en'] as const) {
    it(`offers a localized recipe with merchant-specific template placeholders in ${locale}`, () => {
      const recipe = listTemplates(locale).find(
        (t) => t.slug === 'pago-pendiente-mercadopago'
      )!;
      expect(recipe.requiresGateway).toBe('mercadopago');
      expect(recipe.trigger_type).toBe('payment_pending');
      expect(recipe.suggested_template_body).toContain(
        locale === 'es' ? 'Hola' : 'Hi'
      );
      expect(
        triggerLabel('payment_pending', (key) => translate(locale, key))
      ).toBe(
        locale === 'es'
          ? 'Pago pendiente (Mercado Pago)'
          : 'Pending payment (Mercado Pago)'
      );
      const sends = recipe.steps.filter(
        (step) => step.step_type === 'send_template'
      );
      expect(sends).toHaveLength(3);
      for (const step of sends) {
        const config = step.step_config as Record<string, unknown>;
        expect(config.template_name).toBe('');
        expect(config.language).toBe(locale);
      }
    });
  }
  it('makes original instructions, expiry and method available to templates', () => {
    const points = templateDataPoints('payment_pending');
    for (const key of ['payment_url', 'payment_expiration', 'payment_method']) {
      const point = points.find((p) => p.templateVarKey === key)!;
      expect(point).toBeDefined();
      expect(TEMPLATE_VAR_SAMPLES[key]).toBeTruthy();
      for (const locale of ['es', 'en'] as const)
        expect(translate(locale, point.labelKey)).not.toBe(point.labelKey);
    }
    expect(
      conditionDataPoints('payment_pending').some(
        (p) => p.id === 'payment_method'
      )
    ).toBe(true);
    expect(
      templateDataPoints('payment_rejected').some(
        (p) => p.id === 'payment_method'
      )
    ).toBe(false);
  });
  it('uses absolute reminder times and separate send deadlines', () => {
    const steps = getTemplate('pago-pendiente-mercadopago')!.steps;
    expect(
      steps
        .filter((s) => s.step_type === 'wait')
        .map((s) => (s.step_config as Record<string, unknown>).from_trigger_hours)
    ).toEqual([1, 6, 24]);
    expect(
      steps
        .filter((s) => s.step_type === 'send_template')
        .map((s) => (s.step_config as Record<string, unknown>).expires_after_hours)
    ).toEqual([6, 24, 26]);
  });
});
