import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n';
import { PaymentTimingField, paymentWaitConfig } from './payment-timing';

const state = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en' }));
vi.mock('@/hooks/use-locale', () => ({
  useT: () => (key: string) => translate(state.locale, key),
}));

describe('payment reminder timing editor', () => {
  for (const locale of ['es', 'en'] as const) {
    it(`shows the actual absolute schedule and deadline in ${locale}`, () => {
      state.locale = locale;
      const wait = renderToStaticMarkup(
        <PaymentTimingField
          config={{ amount: 5, from_trigger_hours: 6 }}
          onChange={() => {}}
        />
      );
      expect(wait).toContain('value="6"');
      expect(wait).not.toContain('value="5"');
      expect(wait).toContain(
        locale === 'es' ? 'Horas desde el pago' : 'Hours after payment creation'
      );
      const deadline = renderToStaticMarkup(
        <PaymentTimingField
          config={{ expires_after_hours: 24 }}
          onChange={() => {}}
          deadline
        />
      );
      expect(deadline).toContain('value="24"');
      expect(deadline).toContain(
        locale === 'es' ? 'No enviar después' : 'Do not send after'
      );
    });
  }
  it('updates the clock used by the engine as well as the compatibility fields', () => {
    expect(paymentWaitConfig(8)).toEqual({
      amount: 8,
      unit: 'hours',
      from_trigger_hours: 8,
    });
    expect(paymentWaitConfig(NaN).from_trigger_hours).toBe(1);
    expect(paymentWaitConfig(0).from_trigger_hours).toBe(1);
  });
});
