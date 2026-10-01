import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { widgetOrderRequest, type VisitorOrder } from '@/lib/channels/webchat/order-contract';

const h = vi.hoisted(() => ({ index: 0, bank: [] as unknown[], fetch: vi.fn(), send: vi.fn(), expired: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ SHOW_RIVERZ_IMPROVEMENTS: true }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const i = h.index++;
    if (!(i in h.bank)) h.bank[i] = initial;
    return [h.bank[i], (next: unknown) => { h.bank[i] = typeof next === 'function' ? next(h.bank[i]) : next; }];
  },
  useRef: (initial: unknown) => {
    const i = h.index++; if (!(i in h.bank)) h.bank[i] = { current: initial }; return h.bank[i];
  },
  useEffect: () => {},
}));
import { OrderRequests } from './order-requests';

const order: VisitorOrder = { id: '11111111-1111-4111-8111-111111111111', reference: '#1', created_at: '2026-10-01T12:00:00.123456Z' };
const page = (orders: VisitorOrder[], next_cursor: string | null = null) => new Response(JSON.stringify({ orders, next_cursor }), { status: 200 });
type Element = React.ReactElement<Record<string, unknown>>;
function nodes(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const value = node as Element;
  return [value, ...nodes(value.props.children as React.ReactNode)];
}
function render(locale: 'es' | 'en' = 'es') {
  h.index = 0;
  return nodes(OrderRequests({ session: 'private-session', locale, onSend: h.send, onExpired: h.expired }));
}
function element(type: string, text?: string, locale: 'es' | 'en' = 'es') {
  const value = render(locale).find(node => node.type === type && (!text || node.props.children === text));
  if (!value) throw new Error(`missing ${type} ${text}`);
  return value;
}
function click(node: Element, event: unknown = {}) { (node.props.onClick as (event: unknown) => void)(event); }
async function open(locale: 'es' | 'en' = 'es') {
  click(element('summary', undefined, locale), { currentTarget: { parentElement: { hasAttribute: () => false } } });
  await vi.waitFor(() => expect(h.bank[2]).toBe(false));
}

beforeEach(() => { h.index = 0; h.bank = []; h.fetch.mockResolvedValue(page([order])); h.send.mockResolvedValue(true); vi.stubGlobal('fetch', h.fetch); });
afterEach(() => vi.unstubAllGlobals());

describe('widget order handlers with a bounded React hook harness', () => {
  it('waits for an explicit opening and keeps the token in a header', async () => {
    render(); expect(h.fetch).not.toHaveBeenCalled(); await open();
    expect(h.fetch).toHaveBeenCalledWith('/api/widget/orders?locale=es', expect.objectContaining({ headers: { Authorization: 'Bearer private-session' }, cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(element('button', '#1')).toBeDefined();
  });
  it.each(['es', 'en'] as const)('sends a guided request through the existing chat sender in %s', async locale => {
    await open(locale); click(element('button', '#1', locale));
    (element('select', undefined, locale).props.onChange as (event: unknown) => void)({ target: { value: 'variant' } });
    (element('textarea', undefined, locale).props.onChange as (event: unknown) => void)({ target: { value: 'Blue, size L' } });
    await (element('form', undefined, locale).props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: () => {} });
    expect(h.send).toHaveBeenCalledWith(widgetOrderRequest(locale, order, 'variant', 'Blue, size L'));
    expect(render(locale).some(node => node.type === 'form')).toBe(false);
  });
  it('keeps the selected request if the existing chat sender reports failure', async () => {
    h.send.mockResolvedValue(false); await open(); click(element('button', '#1'));
    await (element('form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: () => {} });
    expect(h.send).toHaveBeenCalledOnce(); expect(element('form')).toBeDefined();
  });
  it('distinguishes a failed read from an empty order list and can retry', async () => {
    h.fetch.mockResolvedValueOnce(new Response('{}', { status: 503 })); await open();
    expect(render().some(node => node.props.children === 'No hay pedidos vinculados a este chat.')).toBe(false);
    click(element('button', 'No se pudieron consultar los pedidos. Intenta de nuevo.'));
    await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(element('button', '#1')).toBeDefined();
  });
  it('reports an expired session instead of treating it as an empty list', async () => {
    h.fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })); await open();
    expect(h.expired).toHaveBeenCalledOnce(); expect(h.bank[0]).toBeNull();
  });
  it('appends older pages without duplicating a repeated order and retains microseconds', async () => {
    const cursor = JSON.stringify({ id: order.id, created_at: order.created_at });
    h.fetch.mockResolvedValueOnce(page([order], cursor)).mockResolvedValueOnce(page([order, { ...order, id: '22222222-2222-4222-8222-222222222222', reference: '#2' }]));
    await open(); click(element('button', 'Ver anteriores'));
    await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(render().filter(node => node.type === 'button' && node.props.children === '#1')).toHaveLength(1);
    expect(element('button', '#2')).toBeDefined();
    expect(new URL(String(h.fetch.mock.calls[1][0]), 'https://riverz.co').searchParams.get('cursor')).toBe(cursor);
  });
  it('refreshes orders when reopening after a new order is created', async () => {
    h.fetch.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([order]));
    await open(); expect(h.bank[0]).toEqual([]); await open();
    expect(element('button', '#1')).toBeDefined();
  });
});
