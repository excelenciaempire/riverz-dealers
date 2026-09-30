import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/lib/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/components/i18n/locale-link', () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
import { AvisoDeCobro } from './aviso-cobro';
it.each(['gracia', 'mensualidad_pausada'] as const)('shows a real invoice link for %s', async aviso => {
  const html = renderToStaticMarkup(await AvisoDeCobro({ aviso, horas: 12, invoiceUrl: 'https://invoice.stripe.com/i/pay/test' }));
  expect(html).toContain('href="https://invoice.stripe.com/i/pay/test"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('settings.avisoGraciaCta');
});
it('falls back to billing for invalid links and removes the reminder after payment', async () => {
  const html = renderToStaticMarkup(await AvisoDeCobro({ aviso: 'mensualidad_pausada', horas: 0, invoiceUrl: 'javascript:alert(1)' }));
  expect(html).toContain('/ajustes?tab=billing');
  expect(html).not.toContain('javascript:');
  expect(await AvisoDeCobro({ aviso: null, horas: null })).toBeNull();
});
