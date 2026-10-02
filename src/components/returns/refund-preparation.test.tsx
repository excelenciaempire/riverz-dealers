import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
import type {Locale} from '@/lib/i18n/config';
const f=vi.hoisted(()=>({index:0,bank:[] as unknown[],enabled:true,locale:'es' as Locale,fetch:vi.fn(),write:vi.fn(),cleanup:undefined as (()=>void)|undefined}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=>(key:string,vars?:Record<string,string|number>)=>translate(f.locale,key,vars)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({dateTime:(value:string)=>value,number:(value:number)=>String(value),currency:(amount:number,currency:string)=>`${currency} ${amount.toFixed(2)}`})}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>f.write}));
vi.mock('@/components/i18n/locale-link',()=>({default:'a'}));vi.mock('@/components/ui/button',()=>({Button:'button'}));vi.mock('@/components/ui/input',()=>({Input:'input'}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState:(initial:unknown)=>{const i=f.index++;if(!(i in f.bank))f.bank[i]=initial;return[f.bank[i],(next:unknown)=>{f.bank[i]=typeof next==='function'?next(f.bank[i]):next;}];},
 useRef:(initial:unknown)=>{const i=f.index++;if(!(i in f.bank))f.bank[i]={current:initial};return f.bank[i];},useEffect:(effect:()=>()=>void)=>{f.cleanup=effect();},
}));
import {ReturnRefundPreparation} from './refund-preparation';
const id='11111111-1111-4111-8111-111111111111',conv='22222222-2222-4222-8222-222222222222',contact='33333333-3333-4333-8333-333333333333',order='44444444-4444-4444-8444-444444444444',event='55555555-5555-4555-8555-555555555555';
const receipt={id:event,reference:'Warehouse 42',quantity:2,condition:'damaged',recorded_at:'2026-10-01T12:00:00Z'},context={case_id:id,conversation_id:conv,order_id:order,contact_id:contact,receipt};
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(node:React.ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];const value=node as Element;return[value,...nodes(value.props.children as React.ReactNode)];}
function render(){f.index=0;return nodes(ReturnRefundPreparation({caseId:id}));}
function element(type:string,text?:string){const node=render().find(node=>node.type===type&&(!text||node.props.children===text));if(!node)throw Error('missing '+type+' '+text);return node;}
function toggle(open:boolean){(element('details').props.onToggle as (event:unknown)=>void)({currentTarget:{open}});}
async function open(){toggle(true);await vi.waitFor(()=>expect(f.bank[4]).toBe(false));}
async function prepare(){(element('button',translate(f.locale,'returns.refundPrepare')).props.onClick as ()=>void)();await vi.waitFor(()=>expect(f.bank[5]).toBe(false));}
beforeEach(()=>{vi.clearAllMocks();f.index=0;f.bank=[];f.enabled=true;f.locale='es';f.fetch.mockResolvedValue(new Response(JSON.stringify(context)));f.write.mockImplementation(async(_url,options)=>{const input=JSON.parse(options.body);return new Response(JSON.stringify({case_id:id,conversation_id:conv,operation_id:input.id,status:'preview',amount:'25.00',currency:'USD',expires_at:'2026-10-01T12:10:00Z',receipt}));});vi.stubGlobal('fetch',f.fetch);});
afterEach(()=>{f.cleanup?.();vi.unstubAllGlobals();});
describe('Hidden refund preparation control',()=>{
 it.each(['es','en'] as const)('renders and fetches nothing outside comparison in %s',locale=>{f.locale=locale;f.enabled=false;expect(render()).toEqual([]);expect(f.fetch).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('loads only after opening and explains that preparation does not move money in %s',async locale=>{
  f.locale=locale;render();expect(f.fetch).not.toHaveBeenCalled();await open();expect(element('p',translate(locale,'returns.refundPrepareScope'))).toBeDefined();expect(f.write).not.toHaveBeenCalled();
 });
 it('prepares the selected receipt once with a stable retry id and opens the actual case for separate approval',async()=>{
  await open();f.bank[2]='25';f.bank[3]='Checked by team';f.write.mockRejectedValueOnce(Error('lost response'));await prepare();expect(f.bank[1]).toBeNull();await prepare();
  const a=JSON.parse(f.write.mock.calls[0][1].body),b=JSON.parse(f.write.mock.calls[1][1].body);expect(b).toEqual(a);expect(a).toMatchObject({receipt_id:event,amount:25,reason:'Checked by team'});expect(Object.keys(a).sort()).toEqual(['amount','id','reason','receipt_id']);
  expect(element('a').props.href).toBe(`/bandeja?c=${conv}`);expect(element('p',translate('es','returns.refundPreparedScope'))).toBeDefined();expect(f.write.mock.calls.every(call=>String(call[0]).endsWith('/reembolso'))).toBe(true);
 });
 it('preserves explicit whole-balance intent without inventing an amount before a provider read',async()=>{
  await open();f.bank[3]='Reviewed return';await prepare();expect(JSON.parse(f.write.mock.calls[0][1].body).amount).toBeNull();expect(element('p',translate('es','returns.refundProposalAmount',{amount:'USD 25.00'}))).toBeDefined();
 });
 it('requires a reason and rejects a mismatched case or operation in a successful response',async()=>{
  await open();await prepare();expect(f.write).not.toHaveBeenCalled();f.bank[3]='Reviewed return';f.write.mockResolvedValueOnce(new Response(JSON.stringify({case_id:id,conversation_id:conv,operation_id:event,status:'preview',amount:'25.00',currency:'USD',expires_at:'2026-10-01T12:10:00Z',receipt})));
  await prepare();expect(f.bank[1]).toBeNull();expect(f.bank[6]).toBe(translate('es','returns.refundUnavailable'));
 });
 it('does not expose raw fetch/schema errors and ignores a late read after closing',async()=>{
  f.fetch.mockRejectedValueOnce(Error('PRIVATE_NETWORK_DETAIL'));await open();expect(f.bank[6]).toBe(translate('es','returns.refundUnavailable'));
  let finish!:(value:Response)=>void;f.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));toggle(true);const signal=f.fetch.mock.calls[1][1].signal as AbortSignal;toggle(false);expect(signal.aborted).toBe(true);finish(new Response(JSON.stringify(context)));await new Promise(resolve=>setTimeout(resolve,0));expect(f.bank[0]).toBeNull();
 });
});
