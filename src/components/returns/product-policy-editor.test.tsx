import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
import type {Locale} from '@/lib/i18n/config';
const f=vi.hoisted(()=>({index:0,bank:[] as unknown[],enabled:true,locale:'es' as Locale,fetch:vi.fn(),write:vi.fn(),cleanup:undefined as (()=>void)|undefined}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=>(key:string,vars?:Record<string,string|number>)=>translate(f.locale,key,vars)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({dateTime:(value:string)=>value})}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>f.write}));vi.mock('@/components/ui/button',()=>({Button:'button'}));vi.mock('@/components/ui/input',()=>({Input:'input'}));vi.mock('@/components/ui/textarea',()=>({Textarea:'textarea'}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState:(initial:unknown)=>{const i=f.index++;if(!(i in f.bank))f.bank[i]=initial;return[f.bank[i],(next:unknown)=>{f.bank[i]=typeof next==='function'?next(f.bank[i]):next;}];},
 useRef:(initial:unknown)=>{const i=f.index++;if(!(i in f.bank))f.bank[i]={current:initial};return f.bank[i];},useEffect:(effect:()=>()=>void)=>{f.cleanup=effect();}}));
import {ProductReturnPolicyEditor} from './product-policy-editor';
const product='11111111-1111-4111-8111-111111111111',policy={mode:'allow',window_days:30,starts_at:'delivery',remedies:['refund'],conditions:'Inspected'},snapshot={product_id:product,revision:1,policy,changed_at:'2026-10-01T12:00:00Z'};
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(node:React.ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];const value=node as Element;return[value,...nodes(value.props.children as React.ReactNode)];}
function render(){f.index=0;return nodes(ProductReturnPolicyEditor({productId:product}));}
function element(type:string,text?:string){const node=render().find(node=>node.type===type&&(!text||node.props.children===text));if(!node)throw Error('missing '+type+' '+text);return node;}
function toggle(open:boolean){(element('details').props.onToggle as (event:unknown)=>void)({currentTarget:{open}});}
async function open(){toggle(true);await vi.waitFor(()=>expect(f.bank[6]).toBe(false));}
async function save(withdraw=false){(element('button',translate(f.locale,withdraw?'products.returnPolicyWithdraw':'common.save')).props.onClick as ()=>void)();await vi.waitFor(()=>expect(f.bank[7]).toBe(false));}
beforeEach(()=>{vi.clearAllMocks();f.index=0;f.bank=[];f.enabled=true;f.locale='es';f.fetch.mockResolvedValue(new Response(JSON.stringify({snapshot,can_edit:true})));f.write.mockImplementation(async(_url,options)=>{const input=JSON.parse(options.body);return new Response(JSON.stringify({...snapshot,revision:input.expected_revision+1,policy:input.policy}));});vi.stubGlobal('fetch',f.fetch);});
afterEach(()=>{f.cleanup?.();vi.unstubAllGlobals();});
describe('Hidden product policy editor',()=>{
 it.each(['es','en'] as const)('renders/fetches nothing outside comparison in %s',locale=>{f.locale=locale;f.enabled=false;expect(render()).toEqual([]);expect(f.fetch).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('loads on opening and preserves human/financial review in %s',async locale=>{
  f.locale=locale;render();expect(f.fetch).not.toHaveBeenCalled();await open();expect(element('p',translate(locale,'products.returnPolicyScope'))).toBeDefined();expect(element('p',translate(locale,'products.returnPolicyWindowScope'))).toBeDefined();expect(f.write).not.toHaveBeenCalled();
 });
 it('reuses a stable id after a lost response and reads the current version after acknowledgment',async()=>{
  await open();f.write.mockRejectedValueOnce(Error('lost'));await save();await save();const a=JSON.parse(f.write.mock.calls[0][1].body),b=JSON.parse(f.write.mock.calls[1][1].body);
  expect(a).toEqual(b);expect(a).toMatchObject({expected_revision:1,policy});expect(Object.keys(a).sort()).toEqual(['expected_revision','id','policy']);expect(f.fetch).toHaveBeenCalledTimes(2);expect(f.write.mock.calls.every(call=>String(call[0]).endsWith('/return-policy'))).toBe(true);
 });
 it('uses an explicit null withdrawal and never edits general business terms or money',async()=>{
  await open();await save(true);expect(JSON.parse(f.write.mock.calls[0][1].body)).toMatchObject({expected_revision:1,policy:null});expect(f.write.mock.calls).toHaveLength(1);
 });
 it('displays the real current read-only permission and cannot write even if its handler is invoked directly',async()=>{
  f.fetch.mockResolvedValueOnce(new Response(JSON.stringify({snapshot,can_edit:false})));await open();expect(element('fieldset').props.disabled).toBe(true);await save();expect(f.write).not.toHaveBeenCalled();
 });
 it('rejects invalid terms and foreign successful replies without presenting a saved result',async()=>{
  await open();f.bank[5]='0';await save();expect(f.write).not.toHaveBeenCalled();f.bank[5]='30';f.write.mockResolvedValueOnce(new Response(JSON.stringify({...snapshot,product_id:'22222222-2222-4222-8222-222222222222',revision:2})));await save();expect(f.bank[9]).toBe(false);expect(f.bank[8]).toBe(translate('es','products.returnPolicyUnavailable'));
 });
 it('ignores an aborted late read and redacts raw transport/schema errors',async()=>{
  let finish!:(value:Response)=>void;f.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));toggle(true);const signal=f.fetch.mock.calls[0][1].signal as AbortSignal;toggle(false);expect(signal.aborted).toBe(true);finish(new Response(JSON.stringify({snapshot,can_edit:true})));await new Promise(resolve=>setTimeout(resolve,0));expect(f.bank[2]).toBeNull();
  f.fetch.mockRejectedValueOnce(Error('PRIVATE_PROVIDER'));await open();expect(f.bank[8]).toBe(translate('es','products.returnPolicyUnavailable'));
 });
});
