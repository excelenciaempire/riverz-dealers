import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import { formatDateTime, formatNumber } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { ReturnCaseEvent } from '@/lib/returns/history-contract';
const h = vi.hoisted(() => ({ index: 0, bank: [] as unknown[], enabled: true, locale: 'es' as Locale, fetch: vi.fn(), cleanup: undefined as (() => void) | undefined }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(h.locale, key, vars) }));
vi.mock('@/hooks/use-format', () => ({ useFormat: () => ({ dateTime: (value: string) => formatDateTime(value, h.locale), number: (value: number) => formatNumber(value, h.locale) }) }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const i = h.index++; if (!(i in h.bank)) h.bank[i] = initial;
    return [h.bank[i], (next: unknown) => { h.bank[i] = typeof next === 'function' ? next(h.bank[i]) : next; }];
  },
  useRef: (initial: unknown) => { const i = h.index++; if (!(i in h.bank)) h.bank[i] = { current: initial }; return h.bank[i]; },
  useEffect: (effect: () => () => void) => { h.cleanup = effect(); },
}));
import { ReturnCaseHistory } from './case-history';
const row: ReturnCaseEvent = { id: '11111111-1111-4111-8111-111111111111', event_sequence: 10, event_type: 'state_changed', occurred_at: '2026-10-01T12:00:00.123456Z', actor_id: null, status: 'recibida', previous_status: 'aprobada', resolution: 'Received by team', previous_resolution: 'Approved by team', photo_count: 1 };
const page = (events: ReturnCaseEvent[] = [row], next_cursor: string | null = null) => new Response(JSON.stringify({ events, next_cursor }));
type Element = React.ReactElement<Record<string, unknown>>;
function nodes(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const value = node as Element; return [value, ...nodes(value.props.children as React.ReactNode)];
}
function render() { h.index = 0; return nodes(ReturnCaseHistory({ caseId: 'owned-case' })); }
function element(type: string, text?: string) {
  const value = render().find(node => node.type === type && (!text || node.props.children === text));
  if (!value) throw new Error(`missing ${type} ${text}`); return value;
}
function toggle(open: boolean) { (element('details').props.onToggle as (event: unknown) => void)({ currentTarget: { open } }); }
async function open() { toggle(true); await vi.waitFor(() => expect(h.bank[2]).toBe(false)); }
function click(text: string) { (element('button', text).props.onClick as () => void)(); }
beforeEach(() => { h.index = 0; h.bank = []; h.enabled = true; h.locale = 'es'; h.fetch.mockResolvedValue(page()); vi.stubGlobal('fetch', h.fetch); });
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals(); });
describe('reserved case history handlers', () => {
  it.each(['es', 'en'] as const)('does not render or fetch outside comparison in %s', locale => {
    h.locale = locale; h.enabled = false;
    expect(render()).toEqual([]); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('waits for opening and uses a private read without executing any decision', async () => {
    render(); expect(h.fetch).not.toHaveBeenCalled(); await open();
    expect(h.fetch).toHaveBeenCalledWith('/api/devoluciones/owned-case/historial', { cache: 'no-store', signal: expect.any(AbortSignal) });
    expect(element('p', 'Received by team')).toBeDefined();
    expect(render().some(node => Array.isArray(node.props.children) && node.props.children.join('') === 'Aprobada → Producto recibido')).toBe(true);
  });
  it.each(['es', 'en'] as const)('explains an old baseline without inventing past decisions in %s', async locale => {
    h.locale = locale; h.fetch.mockResolvedValue(page([{ ...row, event_type: 'baseline', previous_status: null, previous_resolution: null }])); await open();
    expect(element('p', translate(locale, 'returns.historyBaseline'))).toBeDefined();
    expect(element('time').props.children).toBe(formatDateTime(row.occurred_at, locale));
    expect(element('p', translate(locale, 'returns.historyPhotos', { count: '1' }))).toBeDefined();
  });
  it('preserves first-page rows and deduplicates ids while fetching older events', async () => {
    const cursor = JSON.stringify({ event_sequence: row.event_sequence });
    h.fetch.mockResolvedValueOnce(page([row], cursor)).mockResolvedValueOnce(page([row, { ...row, id: '22222222-2222-4222-8222-222222222222' }]));
    await open(); click('Ver anteriores'); await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(h.bank[0]).toHaveLength(2);
    expect(new URL(String(h.fetch.mock.calls[1][0]), 'https://riverz.co').searchParams.get('cursor')).toBe(cursor);
  });
  it('retries the same older page after a failure without replacing history with empty', async () => {
    const cursor = JSON.stringify({ event_sequence: row.event_sequence });
    h.fetch.mockResolvedValueOnce(page([row], cursor)).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(page([]));
    await open(); click('Ver anteriores'); await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(h.bank[0]).toHaveLength(1); expect(render().some(node => node.props.role === 'alert')).toBe(true);
    expect(render().some(node => node.props.children === 'No hay cambios registrados.')).toBe(false);
    click(translate('es', 'common.retry')); await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(h.fetch.mock.calls[2][0]).toBe(h.fetch.mock.calls[1][0]); expect(h.bank[0]).toHaveLength(1);
  });
  it('rejects malformed successful responses rather than displaying an empty history', async () => {
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ events: [{}], next_cursor: null }))); await open();
    expect(h.bank[3]).toBe(true); expect(h.bank[0]).toBeNull();
  });
  it('shows explicit removal without presenting the old note as the current resolution', async () => {
    h.fetch.mockResolvedValue(page([{ ...row, resolution: null }])); await open();
    expect(element('p', 'Nota retirada')).toBeDefined();
    expect(element('p', 'Nota anterior: Approved by team')).toBeDefined();
    expect(render().some(node => node.props.children === 'Received by team')).toBe(false);
  });
  it('refreshes on reopen instead of retaining a previous observation', async () => {
    await open(); toggle(false); h.fetch.mockResolvedValueOnce(page([{ ...row, resolution: 'Fresh note' }])); await open();
    expect(h.fetch).toHaveBeenCalledTimes(2); expect(element('p', 'Fresh note')).toBeDefined();
  });
  it('aborts a closing or unmounted panel and ignores a late result', async () => {
    let finish!: (value: Response) => void;
    h.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    toggle(true); const signal = h.fetch.mock.calls[0][1].signal as AbortSignal;
    toggle(false); expect(signal.aborted).toBe(true);
    finish(page()); await new Promise(resolve => setTimeout(resolve, 0)); expect(h.bank[0]).toBeNull();
    h.fetch.mockImplementationOnce(() => new Promise(() => {})); toggle(true); h.cleanup?.();
    expect((h.fetch.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
  });
});
