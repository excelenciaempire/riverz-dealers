import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
import type {Locale} from '@/lib/i18n/config';
const f=vi.hoisted(()=>({index:0,bank:[] as unknown[],enabled:true,locale:'es' as Locale,fetch:vi.fn(),write:vi.fn(),changed:vi.fn(),toast:vi.fn(),cleanup:undefined as (()=>void)|undefined}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=>(key:string,vars?:Record<string,string|number>)=>translate(f.locale,key,vars)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({dateTime:(value:string)=>value,number:(value:number)=>String(value)})}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>f.write}));
vi.mock('@/components/ui/button',()=>({Button:'button'}));vi.mock('@/components/ui/input',()=>({Input:'input'}));vi.mock('sonner',()=>({toast:{error:f.toast,success:f.toast}}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),
 useState:(initial:unknown)=>{const i=f.index++;if(!(i in f.bank))f.bank[i]=initial;return[f.bank[i],(next:unknown)=>{f.bank[i]=typeof next==='function'?next(f.bank[i]):next;}];},
 useRef:(initial:unknown)=>{const i=f.index++;if(!(i in f.bank))f.bank[i]={current:initial};return f.bank[i];},useEffect:(effect:()=>()=>void)=>{f.cleanup=effect();},
}));
import {ReturnLogisticsEvidence} from './logistics-evidence';
const id='11111111-1111-4111-8111-111111111111',stamp='2026-10-01T12:00:00.123456Z';
const page={case_id:id,status:'aprobada',updated_at:stamp,platform:null,events:[],next_cursor:null};
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(node:React.ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];const value=node as Element;return[value,...nodes(value.props.children as React.ReactNode)];}
function render(){f.index=0;return nodes(ReturnLogisticsEvidence({caseId:id,onChanged:f.changed}));}
function element(type:string,text?:string){const node=render().find(node=>node.type===type&&(!text||node.props.children===text));if(!node)throw Error('missing '+type+' '+text);return node;}
function toggle(open:boolean){(element('details').props.onToggle as (event:unknown)=>void)({currentTarget:{open}});}
async function open(){toggle(true);await vi.waitFor(()=>expect(f.bank[1]).toBe(false));}
async function save(){(element('button',translate(f.locale,'common.save')).props.onClick as ()=>void)();await vi.waitFor(()=>expect(f.bank[3]).toBe(false));}
beforeEach(()=>{vi.clearAllMocks();f.index=0;f.bank=[];f.enabled=true;f.locale='es';f.fetch.mockResolvedValue(new Response(JSON.stringify(page)));f.write.mockImplementation(async(_url,options)=>new Response(JSON.stringify({event_id:JSON.parse(options.body).id,unchanged:false})));vi.stubGlobal('fetch',f.fetch);});
afterEach(()=>{f.cleanup?.();vi.unstubAllGlobals();});
describe('Hidden manual logistics panel',()=>{
 it.each(['es','en'] as const)('does not render or load outside comparison in %s',locale=>{f.locale=locale;f.enabled=false;expect(render()).toEqual([]);expect(f.fetch).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('waits for opening and explains manual evidence in %s',async locale=>{
  f.locale=locale;render();expect(f.fetch).not.toHaveBeenCalled();await open();expect(element('p',translate(locale,'returns.logisticsScope'))).toBeDefined();expect(f.write).not.toHaveBeenCalled();
 });
 it('reuses the same identifier after a lost response and only confirms a matching server receipt',async()=>{
  await open();f.bank[5]='Example';f.bank[6]='42';f.write.mockRejectedValueOnce(Error('lost response'));await save();expect(f.changed).not.toHaveBeenCalled();await save();
  const first=JSON.parse(f.write.mock.calls[0][1].body),second=JSON.parse(f.write.mock.calls[1][1].body);expect(second.id).toBe(first.id);expect(second).toEqual(first);expect(f.changed).toHaveBeenCalledTimes(1);
 });
 it('never submits actor/workspace overrides or a payment, and preserves human receipt time on retry',async()=>{
  await open();f.bank[4]='receipt';f.bank[7]='Warehouse 42';f.bank[8]='2';f.bank[9]='damaged';f.bank[10]='Team checked';await save();
  const input=JSON.parse(f.write.mock.calls[0][1].body);expect(Object.keys(input).sort()).toEqual(['expected_updated_at','id','kind','payload']);expect(input.payload).toMatchObject({quantity:2,condition:'damaged',reference:'Warehouse 42'});expect(input.payload.received_at).toMatch(/Z$/);expect(f.changed).toHaveBeenCalledTimes(1);
 });
 it('keeps provider-managed or closed cases read-only',async()=>{
  f.fetch.mockResolvedValue(new Response(JSON.stringify({...page,platform:'mercadolibre'})));await open();expect(render().some(node=>node.type==='fieldset')).toBe(false);expect(f.write).not.toHaveBeenCalled();
  toggle(false);f.fetch.mockResolvedValue(new Response(JSON.stringify({...page,status:'resuelta'})));await open();expect(render().some(node=>node.type==='fieldset')).toBe(false);
 });
 it('rejects malformed/wrong-case successful responses and cancels late reads after closing',async()=>{
  f.fetch.mockResolvedValueOnce(new Response(JSON.stringify({...page,case_id:'other'})));await open();expect(f.bank[2]).toBe(true);
  let finish!:(value:Response)=>void;f.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));toggle(true);const signal=f.fetch.mock.calls[1][1].signal as AbortSignal;toggle(false);expect(signal.aborted).toBe(true);finish(new Response(JSON.stringify(page)));await new Promise(resolve=>setTimeout(resolve,0));expect(f.bank[0]).toBeNull();
 });
});
