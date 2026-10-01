import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import { formatDateTime,formatNumber } from '@/lib/i18n/format';
import { caseReasonCsv,reportedReason,type CaseReasonReport } from '@/lib/dashboard/case-reason-contract';
import type { Locale } from '@/lib/i18n/config';
const h=vi.hoisted(() => ({ index:0,bank:[] as unknown[],enabled:true,locale:'es' as Locale,fetch:vi.fn(),cleanup:undefined as (() => void)|undefined }));
vi.mock('@/lib/ui/improvements-preview',() => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/components/i18n/locale-link',() => ({ default:'a' }));
vi.mock('@/hooks/use-locale',() => ({ useLocale:() => ({ locale:h.locale }),useT:() => (key:string,vars?:Record<string,string|number>) => translate(h.locale,key,vars) }));
vi.mock('@/hooks/use-format',() => ({ useFormat:() => ({ dateTime:(value:string) => formatDateTime(value,h.locale),number:(value:number,options?:Intl.NumberFormatOptions) => formatNumber(value,h.locale,options) }) }));
vi.mock('react',async() => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState:(initial:unknown) => { const i=h.index++;if(!(i in h.bank)) h.bank[i]=initial;return [h.bank[i],(next:unknown) => { h.bank[i]=typeof next==='function'?next(h.bank[i]):next; }]; },
  useRef:(initial:unknown) => { const i=h.index++;if(!(i in h.bank)) h.bank[i]={ current:initial };return h.bank[i]; },
  useEffect:(effect:() => () => void) => { h.cleanup=effect(); },
}));
import { CaseReasonsCard } from './case-reasons-card';
const range={ start:'2026-10-01T00:00:00Z',end:'2026-10-08T00:00:00Z',previous_start:'2026-09-24T00:00:00Z',previous_end:'2026-10-01T00:00:00Z' };
let currentRange=range;
const id='11111111-1111-4111-8111-111111111111';
function report():CaseReasonReport { return { ...range,observed_at:'2026-10-09T00:00:00Z',rows:reportedReason.options.map(reason => ({ reason,current_count:reason==='delivery'?1203:0,previous_count:0,rated_count:reason==='delivery'?2:0,positive_count:reason==='delivery'?1:0 })),selected_reason:null,cases:null,next_cursor:null }; }
const evidence={ id,channel:'whatsapp',reason:'delivery' as const,created_at:'2026-10-02T00:00:00.123456Z',csat:1 as const };
const page=(data=report()) => new Response(JSON.stringify(data));
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(node:React.ReactNode):Element[] { if(Array.isArray(node)) return node.flatMap(nodes);if(!React.isValidElement(node)) return [];const value=node as Element;return [value,...nodes(value.props.children as React.ReactNode)]; }
function render() { h.index=0;return nodes(CaseReasonsCard({ range:currentRange })); }
function element(type:string,text?:string) { const value=render().find(node => node.type===type && (!text || node.props.children===text));if(!value) throw new Error(`missing ${type} ${text}`);return value; }
function toggle(open:boolean) { (element('details').props.onToggle as (event:unknown) => void)({ currentTarget:{ open } }); }
async function open() { toggle(true);await vi.waitFor(() => expect(h.bank[2]).toBe(false)); }
function click(text:string) { (element('button',text).props.onClick as () => void)(); }
beforeEach(() => { h.index=0;h.bank=[];h.enabled=true;h.locale='es';currentRange=range;h.fetch.mockReset().mockResolvedValue(page());vi.stubGlobal('fetch',h.fetch); });
afterEach(() => { h.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks(); });
describe('reason report handlers behind comparison',() => {
  it.each(['es','en'] as const)('renders nothing and does not fetch outside comparison in %s',locale => { h.enabled=false;h.locale=locale;expect(render()).toEqual([]);expect(h.fetch).not.toHaveBeenCalled(); });
  it.each(['es','en'] as const)('waits for opening and shows ratings with their real denominator in %s',async locale => {
    h.locale=locale;render();expect(h.fetch).not.toHaveBeenCalled();await open();
    const params=new URL(String(h.fetch.mock.calls[0][0]),'https://riverz.co').searchParams;
    expect(Object.fromEntries(params)).toEqual(range);expect(h.fetch.mock.calls[0][1]).toMatchObject({ cache:'no-store',signal:expect.any(AbortSignal) });
    expect(element('th',translate(locale,'dashboard.caseReasons_ratedCases'))).toBeDefined();
    expect(element('td','50%')).toBeDefined();expect(element('td','—')).toBeDefined();
    expect(element('button',translate(locale,'inbox.caseUnclassified'))).toBeDefined();
  });
  it('reads the selected reason and links only its returned case, preserving microseconds while paging',async() => {
    const cursor={ id,created_at:evidence.created_at };
    h.fetch.mockResolvedValueOnce(page()).mockResolvedValueOnce(page({ ...report(),selected_reason:'delivery',cases:[evidence],next_cursor:cursor })).mockResolvedValueOnce(page({ ...report(),selected_reason:'delivery',cases:[evidence,{ ...evidence,id:'22222222-2222-4222-8222-222222222222' }],next_cursor:null }));
    await open();click('Envío');await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(element('a').props.href).toBe(`/bandeja?c=${id}`);
    click('Ver anteriores');await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(h.bank[1]).toHaveLength(2);expect(new URL(String(h.fetch.mock.calls[2][0]),'https://riverz.co').searchParams.get('cursor')).toBe(JSON.stringify(cursor));
  });
  it('keeps the observation and evidence when an older page fails, then retries that exact cursor',async() => {
    const selected={ ...report(),selected_reason:'delivery' as const,cases:[evidence],next_cursor:{ id,created_at:evidence.created_at } };
    h.fetch.mockResolvedValueOnce(page()).mockResolvedValueOnce(page(selected)).mockResolvedValueOnce(new Response('{}',{ status:503 })).mockResolvedValueOnce(page({ ...selected,next_cursor:null }));
    await open();click('Envío');await vi.waitFor(() => expect(h.bank[2]).toBe(false));click('Ver anteriores');await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(h.bank[1]).toHaveLength(1);expect(h.bank[3]).toBe(true);
    click(translate('es','common.retry'));await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(h.fetch.mock.calls[3][0]).toBe(h.fetch.mock.calls[2][0]);expect(h.bank[1]).toHaveLength(1);
  });
  it('does not turn malformed data or a stale window into six zero counts',async() => {
    h.fetch.mockResolvedValueOnce(new Response('{}'));await open();expect(h.bank[0]).toBeNull();expect(h.bank[3]).toBe(true);
    h.fetch.mockResolvedValueOnce(page({ ...report(),start:'2026-10-02T00:00:00Z' }));await open();expect(h.bank[0]).toBeNull();expect(h.bank[3]).toBe(true);
  });
  it('exports the observed report without another query and revokes its temporary download URL',async() => {
    await open();vi.useFakeTimers();const clickDownload=vi.fn();vi.stubGlobal('document',{ createElement:() => ({ click:clickDownload }) });
    const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(() => {});
    click('Exportar CSV');expect(h.fetch).toHaveBeenCalledTimes(1);expect(clickDownload).toHaveBeenCalledOnce();
    const blob=create.mock.calls[0][0] as Blob;
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0,3)]).toEqual([0xef,0xbb,0xbf]);
    expect(await blob.text()).toBe(caseReasonCsv('es',report()).slice(1));
    await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalledWith('blob:test');
  });
  it('refreshes on reopening and aborts an unmounted request',async() => {
    await open();toggle(false);await open();expect(h.fetch).toHaveBeenCalledTimes(2);
    h.fetch.mockImplementationOnce(() => new Promise(() => {}));toggle(true);h.cleanup?.();expect((h.fetch.mock.calls[2][1].signal as AbortSignal).aborted).toBe(true);
  });
  it('keeps evidence in its observed window while the live panel advances, until explicitly refreshed',async() => {
    await open();currentRange={ ...range,end:'2026-10-08T00:05:00Z',previous_start:'2026-09-23T23:55:00Z' };
    h.fetch.mockResolvedValueOnce(page({ ...report(),selected_reason:'delivery',cases:[evidence] }));
    click('Envío');await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(new URL(String(h.fetch.mock.calls[1][0]),'https://riverz.co').searchParams.get('end')).toBe(range.end);
    h.fetch.mockResolvedValueOnce(page({ ...report(),...currentRange,selected_reason:'delivery',cases:[evidence] }));
    click('Actualizar');await vi.waitFor(() => expect(h.bank[2]).toBe(false));
    expect(new URL(String(h.fetch.mock.calls[2][0]),'https://riverz.co').searchParams.get('end')).toBe(currentRange.end);
    expect(h.bank[3]).toBe(false);
  });
});
