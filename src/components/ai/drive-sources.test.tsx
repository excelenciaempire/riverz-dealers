import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import { formatDateTime } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
const h = vi.hoisted(() => ({ index: 0, bank: [] as unknown[], enabled: true, locale: 'es' as Locale, fetch: vi.fn(), changed: vi.fn(), cleanup: undefined as (() => void) | undefined }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/hooks/use-locale', () => ({ useLocale: () => ({ t: (key: string) => translate(h.locale, key) }) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({ dateTime: (value: string) => formatDateTime(value, h.locale) }) }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => h.fetch }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/input', () => ({ Input: 'input' }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = h.index++; if (!(i in h.bank)) h.bank[i] = initial; return [h.bank[i], (next: unknown) => { h.bank[i] = typeof next === 'function' ? next(h.bank[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = h.index++; if (!(i in h.bank)) h.bank[i] = { current: initial }; return h.bank[i]; },
  useEffect: (effect: () => () => void) => { h.cleanup = effect(); },
}));
import { DriveSources } from './drive-sources';
const agentId = '11111111-1111-4111-8111-111111111111';
const row = { id: '22222222-2222-4222-8222-222222222222', file_id: 'abcdefghijklmnop', source_id: null, name: null, revision: 3, state: 'queued', synced_at: null, remote_modified_at: null, error_code: null };
const status = { connected: true, email: 'owner@example.com', sources: [row] };
type Element = React.ReactElement<Record<string, unknown>>;
function nodes(node: React.ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!React.isValidElement(node)) return []; const value = node as Element; return [value, ...nodes(value.props.children as React.ReactNode)]; }
function render() { h.index = 0; return nodes(DriveSources({ agentId, onChanged: h.changed })); }
function element(type: string, key?: string) { const value = render().find(node => node.type === type && (!key || node.props.children === translate(h.locale, key))); if (!value) throw new Error(`missing ${type} ${key}`); return value; }
function click(key: string) { const button = element('button', key); expect(button.props.disabled).not.toBe(true); (button.props.onClick as () => void)(); }
function toggle(open: boolean) { (element('details').props.onToggle as (event: unknown) => void)({ currentTarget: { open }, stopPropagation: () => {} }); }
async function settled() { await vi.waitFor(() => expect(h.bank[2]).toBe(false)); }
async function open() { toggle(true); await settled(); }
const response = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code });
beforeEach(() => { h.index = 0; h.bank = []; h.enabled = true; h.locale = 'es'; h.changed.mockReset(); h.fetch.mockReset().mockImplementation(async () => response(status)); vi.stubGlobal('fetch', h.fetch); });
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals(); });
describe('Selected Drive sources reserved for comparison', () => {
  it.each(['es','en'] as const)('keeps production unchanged and fetches only on explicit opening in %s', async locale => {
    h.locale = locale; h.enabled = false; expect(render()).toEqual([]); expect(h.fetch).not.toHaveBeenCalled();
    h.enabled = true; render(); expect(h.fetch).not.toHaveBeenCalled(); await open(); expect(h.fetch).toHaveBeenCalledOnce();
    expect(element('summary').props.children).toBe(translate(locale, 'assistant.driveTitle'));
  });
  it.each(['es','en'] as const)('requires a separate confirmation before withdrawing a selected file in %s', async locale => {
    h.locale = locale; await open(); click('assistant.driveRemove'); expect(h.fetch).toHaveBeenCalledOnce();
    click('assistant.documentsWithdrawConfirm'); await settled(); await vi.waitFor(() => expect(h.changed).toHaveBeenCalledOnce());
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ action: 'remove', id: row.id, revision: 3 });
    expect(h.fetch.mock.calls[1][1].method).toBe('POST');
  });
  it('states the business-wide effect and allows cancellation before disconnecting', async () => {
    await open(); click('assistant.driveDisconnect'); expect(element('p', 'assistant.driveDisconnectEffect')).toBeTruthy(); expect(h.fetch).toHaveBeenCalledOnce();
    click('assistant.documentsBack'); expect(render().some(node => node.props.children === translate('es', 'assistant.driveDisconnectEffect'))).toBe(false);
    click('assistant.driveDisconnect'); click('assistant.documentsWithdrawConfirm'); await settled();
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ action: 'disconnect' });
  });
  it('adds only the selected input and retains it after an import request failure', async () => {
    await open(); (element('input').props.onChange as (event: unknown) => void)({ target: { value: 'https://docs.google.com/document/d/abcdefghijklmnop/edit' } });
    h.fetch.mockResolvedValueOnce(response({ error: translate('es', 'assistant.drive_denied') }, 422));
    (element('form').props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} }); await settled();
    expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toEqual({ action: 'add', file: 'https://docs.google.com/document/d/abcdefghijklmnop/edit' });
    expect(element('input').props.value).toContain('abcdefghijklmnop'); expect(h.changed).not.toHaveBeenCalled(); expect(element('p', 'assistant.drive_denied').props.role).toBe('alert');
  });
  it.each(['es','en'] as const)('localizes transport errors without exposing native exception text in %s', async locale => {
    h.locale = locale; h.fetch.mockRejectedValueOnce(new Error('private infrastructure failure')); await open();
    expect(element('p', 'assistant.drive_unavailable').props.role).toBe('alert'); expect(h.bank[0]).toBeNull();
  });
  it('cancels pending loads when collapsed', async () => {
    h.fetch.mockImplementationOnce(() => new Promise(() => {})); toggle(true); toggle(false);
    expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true); expect(h.bank[2]).toBe(false);
  });
});
