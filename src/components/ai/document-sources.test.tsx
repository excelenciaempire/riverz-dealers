import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
const h = vi.hoisted(() => ({ index: 0, bank: [] as unknown[], enabled: true, locale: 'es' as Locale, fetch: vi.fn(), cleanup: undefined as (() => void) | undefined }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/hooks/use-locale', () => ({ useLocale: () => ({ locale: h.locale, t: (key: string, vars?: Record<string, string | number>) => translate(h.locale, key, vars) }) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({ dateTime: (value: string) => formatDateTime(value, h.locale), number: (value: number) => formatNumber(value, h.locale) }) }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => h.fetch }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: 'textarea' }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = h.index++;if (!(i in h.bank)) h.bank[i] = initial;return [h.bank[i], (next: unknown) => { h.bank[i] = typeof next === 'function' ? next(h.bank[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = h.index++;if (!(i in h.bank)) h.bank[i] = { current: initial };return h.bank[i]; },
  useEffect: (effect: () => () => void) => { h.cleanup = effect(); },
}));
import { DocumentSources } from './document-sources';
const agentId = '11111111-1111-4111-8111-111111111111';
const source = { id: '22222222-2222-4222-8222-222222222222', name: 'Policy.docx', format: 'docx', bytes: 100, sha256: 'a'.repeat(64), text: 'Reviewed policy', status: 'draft', revision: 1, updated_at: '2026-10-01T00:00:00Z' };
type Element = React.ReactElement<Record<string, unknown>>;
function nodes(node: React.ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(nodes);if (!React.isValidElement(node)) return [];const value = node as Element;return [value, ...nodes(value.props.children as React.ReactNode)]; }
function render() { h.index = 0;return nodes(DocumentSources({ agentId })); }
function element(type: string, text?: string) { const value = render().find(node => node.type === type && (!text || node.props.children === text));if (!value) throw new Error(`missing ${type} ${text}`);return value; }
function click(key: string) { const button = element('button', translate(h.locale, key));expect(button.props.disabled).not.toBe(true);(button.props.onClick as () => void)(); }
function toggle(open: boolean) { (element('details').props.onToggle as (event: unknown) => void)({ currentTarget: { open } }); }
async function open() { toggle(true);await vi.waitFor(() => expect(h.bank[4]).toBe(false)); }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
beforeEach(() => { h.index = 0;h.bank = [];h.enabled = true;h.locale = 'es';h.fetch.mockReset().mockResolvedValue(response({ sources: [source], can_edit: true }));vi.stubGlobal('fetch', h.fetch); });
afterEach(() => { h.cleanup?.();vi.unstubAllGlobals(); });
describe('document controls reserved for comparison', () => {
  it.each(['es','en'] as const)('does not render or fetch in the production interface in %s', locale => { h.enabled = false;h.locale = locale;expect(render()).toEqual([]);expect(h.fetch).not.toHaveBeenCalled(); });
  it.each(['es','en'] as const)('loads only when opened and requires review of the exact draft before activation in %s', async locale => {
    h.locale = locale;render();expect(h.fetch).not.toHaveBeenCalled();await open();
    const button = element('button', translate(locale, 'assistant.documentsActivate'));expect(button.props.disabled).toBe(true);
    const checkbox = render().find(node => node.type === 'input' && node.props.type === 'checkbox')!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    h.fetch.mockResolvedValueOnce(response({ ...source, status: 'active', revision: 2 }));click('assistant.documentsActivate');await vi.waitFor(() => expect(h.bank[4]).toBe(false));
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ action: 'activate', source_id: source.id, revision: 1 });expect(h.bank[6]).toBe(false);
    expect(render().find(node => node.props.children === translate(locale, 'assistant.documentsActivate'))).toBeUndefined();
  });
  it('does not grant mutation controls to a read-only member', async () => {
    h.fetch.mockResolvedValueOnce(response({ sources: [source], can_edit: false }));await open();expect(element('textarea').props.readOnly).toBe(true);
    expect(render().filter(node => node.type === 'button').map(node => node.props.children)).not.toContain(translate('es', 'assistant.documentsUpload'));
  });
  it('saving changed text uses the observed revision and does not activate automatically', async () => {
    await open();(element('textarea').props.onChange as (event: unknown) => void)({ target: { value: 'Corrected source' } });
    h.fetch.mockResolvedValueOnce(response({ ...source, text: 'Corrected source', revision: 2 }));click('assistant.documentsSave');await vi.waitFor(() => expect(h.bank[4]).toBe(false));
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ action: 'edit', source_id: source.id, revision: 1, text: 'Corrected source' });expect(element('button', translate('es', 'assistant.documentsActivate')).props.disabled).toBe(true);
  });
  it('withdrawal requires a separate explicit confirmation and retains the source in the list', async () => {
    h.fetch.mockResolvedValueOnce(response({ sources: [{ ...source, status: 'active', revision: 2 }], can_edit: true }));await open();click('assistant.documentsWithdraw');expect(h.fetch).toHaveBeenCalledTimes(1);
    h.fetch.mockResolvedValueOnce(response({ ...source, status: 'withdrawn', revision: 3 }));click('assistant.documentsWithdrawConfirm');await vi.waitFor(() => expect(h.bank[4]).toBe(false));
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ action: 'withdraw', source_id: source.id, revision: 2 });expect(h.bank[0]).toHaveLength(1);
  });
  it('keeps an unsaved draft after a concurrent edit failure and allows an explicit refresh', async () => {
    await open();(element('textarea').props.onChange as (event: unknown) => void)({ target: { value: 'My draft' } });
    h.fetch.mockResolvedValueOnce(response({ error: translate('es', 'assistant.document_changed') }, 409));click('assistant.documentsSave');await vi.waitFor(() => expect(h.bank[4]).toBe(false));
    expect(element('textarea').props.value).toBe('My draft');expect(element('p', translate('es', 'assistant.document_changed')).props.role).toBe('alert');
    h.fetch.mockResolvedValueOnce(response({ sources: [{ ...source, text: 'Other editor', revision: 2 }], can_edit: true }));click('assistant.documentsRefresh');await vi.waitFor(() => expect(h.bank[4]).toBe(false));expect(element('textarea').props.value).toBe('Other editor');
  });
  it('does not claim successful import after a file error', async () => {
    await open();h.fetch.mockResolvedValueOnce(response({ error: translate('es', 'assistant.document_no_text') }, 422));
    const event = { target: { files: [new File(['test'], 'scan.pdf', { type: 'application/pdf' })], value: 'file' } };
    (render().find(node => node.type === 'input' && node.props.type === 'file')!.props.onChange as (event: unknown) => void)(event);
    await vi.waitFor(() => expect(h.bank[4]).toBe(false));expect(event.target.value).toBe('');expect(h.bank[0]).toHaveLength(1);expect(h.bank[3]).toBe(translate('es', 'assistant.document_no_text'));
  });
  it('re-reads on reopening and cancels a pending request when closed', async () => {
    await open();toggle(false);await open();expect(h.fetch).toHaveBeenCalledTimes(2);
    h.fetch.mockImplementationOnce(() => new Promise(() => {}));toggle(true);toggle(false);expect((h.fetch.mock.calls[2][1].signal as AbortSignal).aborted).toBe(true);
  });
});
