import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import type { OutcomeReport } from '@/lib/dashboard/outcomes';
const h = vi.hoisted(() => ({ enabled: true, locale: 'es' as 'es' | 'en', index: 0, bank: [] as unknown[], blob: null as Blob | null, click: vi.fn(), revoke: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/hooks/use-locale', () => ({ useLocale: () => ({ locale: h.locale }), useT: () => (key: string, vars?: Record<string, string | number>) => translate(h.locale, key, vars) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({ number: String, dateTime: String }) }));
vi.mock('@/components/i18n/locale-link', () => ({ default: 'a' }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useState: (initial: unknown) => {
  const index = h.index++; if (!(index in h.bank)) h.bank[index] = initial;
  return [h.bank[index], (next: unknown) => { h.bank[index] = typeof next === 'function' ? next(h.bank[index]) : next; }];
} }));
import { OutcomeEvidence } from './outcome-evidence';
const id = '11111111-1111-4111-8111-111111111111';
const report: OutcomeReport = { range: { start: '2026-09-20T00:00:00Z', end: '2026-09-30T00:00:00Z' },
  attended: 1, verified: 1, rate: 1, toReview: 0, human: 0, pending: [], trial: null,
  breakdown: { tracking: 1, product: 0, confirmation: 0, address: 0, return: 0, other: 0 },
  cases: [{ id, name: 'Synthetic private name', channel: 'whatsapp', at: '2026-09-25T12:01:00Z', lastMessageId: id,
    state: 'verified', category: 'tracking', verifiedAt: '2026-09-25T12:02:00Z', firstCustomerAt: '2026-09-25T12:00:00Z', verificationSeconds: 120 }],
  verificationTiming: { samples: 1, unavailable: 0, medianSeconds: 120, basis: 'first_customer_to_current_team_review' },
};
const render = (data = report) => { h.index = 0; return OutcomeEvidence({ report: data }); };
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes); if (!React.isValidElement(node)) return [];
  const item = node as React.ReactElement<Record<string, unknown>>; return [item, ...nodes(item.props.children as React.ReactNode)];
}
beforeEach(() => { vi.clearAllMocks(); h.enabled = true; h.locale = 'es'; h.bank = []; h.blob = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { h.blob = blob as Blob; return 'blob:synthetic'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(h.revoke);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('optional outcome evidence', () => {
  it.each(['es', 'en'] as const)('remains hidden outside comparison in %s', locale => {
    h.enabled = false; h.locale = locale; expect(renderToStaticMarkup(render())).toBe('');
  });
  it.each(['es', 'en'] as const)('labels its measurement and links source cases in %s', locale => {
    h.locale = locale; const html = renderToStaticMarkup(render());
    expect(html).toContain(translate(locale, 'dashboard.timingBasis')); expect(html).toContain('/bandeja?c=' + id);
    expect(html).not.toContain('dashboard.'); expect(html).not.toContain('Synthetic private name');
  });
  it('exports the observed cohort with safe CSV cells, a BOM and no personal data', async () => {
    const data = { ...report, cases: [{ ...report.cases[0], channel: '=SUM(A1)' }] };
    vi.stubGlobal('document', { createElement: () => ({ click: h.click }) });
    const button = nodes(render(data)).find(node => node.type === 'button')!;
    (button.props.onClick as () => void)();
    expect(h.click).toHaveBeenCalledOnce(); expect(h.revoke).toHaveBeenCalledWith('blob:synthetic');
    expect(Array.from(new Uint8Array(await h.blob!.arrayBuffer())).slice(0, 3)).toEqual([239, 187, 191]);
    const csv = await h.blob!.text(); expect(csv).toContain("'=SUM(A1)"); expect(csv).toContain(report.range.start);
    expect(csv).not.toContain('Synthetic private name'); expect(csv).not.toContain('dashboard.');
  });
  it('distinguishes unavailable timing from zero and filters the observed case list', () => {
    const noDates = { ...report, verificationTiming: undefined };
    expect(renderToStaticMarkup(render(noDates))).toContain('—');
    const select = nodes(render()).find(node => node.type === 'select')!;
    (select.props.onChange as (event: unknown) => void)({ target: { value: 'human' } });
    expect(renderToStaticMarkup(render())).toContain(translate('es', 'dashboard.timingEmpty'));
  });
});
