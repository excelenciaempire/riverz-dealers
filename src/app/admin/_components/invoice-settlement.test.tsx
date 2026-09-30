import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CuentaDelNegocio } from '@/lib/billing/negocio';
import { translate } from '@/lib/i18n/translate';
const locale = vi.hoisted(() => ({ value: 'es' as 'es' | 'en' }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, params?: Record<string, string>) => translate(locale.value, key, params) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({ currency: (amount: number, currency: string) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency }).format(amount) }) }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => vi.fn() }));
import { InvoiceSettlement } from './invoice-settlement';
const account = { workspaceId: 'pilar', pendingInvoice: { id: 'in_test', amountRemaining: 9900, currency: 'usd' } } as CuentaDelNegocio;
it.each(['es', 'en'] as const)('shows the pending $99 invoice and settlement button in %s', lang => {
  locale.value = lang;
  const html = renderToStaticMarkup(<InvoiceSettlement account={account} disabled={false} onChanged={() => {}} />);
  expect(html).toContain(lang === 'es' ? 'Marcar como pagada' : 'Mark as paid');
  expect(html).toContain(lang === 'es' ? '99,00' : '99.00');
  expect(html).not.toContain('9900');
});
it('does not offer to settle an account with no unpaid invoice', () => {
  expect(renderToStaticMarkup(<InvoiceSettlement account={{ ...account, pendingInvoice: null }} disabled={false} onChanged={() => {}} />)).toBe('');
});
