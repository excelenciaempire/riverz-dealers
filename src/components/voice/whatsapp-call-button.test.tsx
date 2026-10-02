import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const ws='11111111-1111-4111-8111-111111111111',contactId='22222222-2222-4222-8222-222222222222';
const h=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en',index:0,bank:[] as unknown[],effects:[] as (()=>void|(()=>void))[],fetch:vi.fn(),storage:new Map<string,string>()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=> (key:string)=>translate(h.locale,key)}));vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.fetch}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]=initial;return [h.bank[n],(value:unknown)=>{h.bank[n]=typeof value==='function'?value(h.bank[n]):value;}];},useRef:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]={current:initial};return h.bank[n];},useEffect:(effect:()=>void|(()=>void))=>{h.effects.push(effect);}}));
import {WhatsAppCallButton} from './whatsapp-call-button';
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(raw:React.ReactNode):Element[]{if(Array.isArray(raw))return raw.flatMap(nodes);if(!React.isValidElement(raw))return [];const e=raw as Element;return [e,...nodes(e.props.children as React.ReactNode)];}
function text(raw:unknown):string{if(Array.isArray(raw))return raw.map(text).join('');if(React.isValidElement(raw))return text((raw as Element).props.children);return typeof raw==='string'?raw:'';}
function render(){h.index=0;return nodes(WhatsAppCallButton({workspaceId:ws,contactId,name:'Fixture contact',phone:'+12025550100'}));}
const button=(key:string)=>render().find(e=>typeof e.props.onClick==='function'&&text(e.props.children)===translate(h.locale,'voice.'+key));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function initialize(){render();return h.effects[0]();}
function confirm(){const checkbox=render().find(e=>e.type==='input'&&e.props.type==='checkbox')!;(checkbox.props.onChange as (event:unknown)=>void)({target:{checked:true}});}
const key=`riverz:whatsapp-call:${ws}:${contactId}`;
const receipt=(callId:string)=>({callId,contactId,state:'initiated',status:'dialing',cleanupState:'not_requested',providerEnded:false});
beforeEach(()=>{
 h.enabled=true;h.locale='es';h.index=0;h.bank=[];h.effects=[];h.storage.clear();
 vi.stubGlobal('sessionStorage',{getItem:(key:string)=>h.storage.get(key)??null,setItem:(key:string,value:string)=>h.storage.set(key,value),removeItem:(key:string)=>h.storage.delete(key)});
 h.fetch.mockReset().mockImplementation(async(url:string,init:RequestInit)=>init.method==='POST'?Response.json({callId:JSON.parse(String(init.body)).attemptId,initiated:true}):Response.json(receipt(new URL(url,'https://fixture.invalid').searchParams.get('callId')!)));
});
afterEach(()=>vi.unstubAllGlobals());
describe('Reviewed WhatsApp call UI, no provider or microphone',()=>{
 it('reuses the original request after an authenticated absent receipt and requires fresh review',async()=>{
  const id='33333333-3333-4333-8333-333333333333';h.storage.set(key,id);initialize();h.fetch.mockResolvedValueOnce(Response.json({code:'attemptNotFound'},{status:404}));
  await(button('whatsappRecover')!.props.onClick as ()=>Promise<void>)();expect(button('whatsappStart')?.props.disabled).toBe(true);expect(h.storage.get(key)).toBe(id);confirm();
  await(button('whatsappStart')!.props.onClick as ()=>Promise<void>)();expect(JSON.parse(String(h.fetch.mock.calls[1][1].body)).attemptId).toBe(id);expect(h.fetch.mock.calls.map(([,init])=>init.method??'GET')).toEqual(['GET','POST']);
 });
 it('does not turn the hidden API 404 into permission to retry',async()=>{
  h.storage.set(key,'33333333-3333-4333-8333-333333333333');initialize();h.fetch.mockResolvedValueOnce(Response.json({error:'not_found'},{status:404}));
  await(button('whatsappRecover')!.props.onClick as ()=>Promise<void>)();expect(button('whatsappStart')).toBeUndefined();expect(button('whatsappRecover')).toBeDefined();
 });
 it('does not show UI, fetch or remember an attempt with the gate closed',()=>{h.enabled=false;expect(render()).toEqual([]);h.effects[0]();expect(h.fetch).not.toHaveBeenCalled();expect(h.storage.size).toBe(0);});
 it.each(['es','en'] as const)('requires explicit recipient review in %s',async locale=>{h.locale=locale;initialize();expect(button('whatsappStart')?.props.disabled).toBe(true);expect(h.fetch).not.toHaveBeenCalled();confirm();expect(button('whatsappStart')?.props.disabled).toBe(false);await(button('whatsappStart')!.props.onClick as ()=>Promise<void>)();expect(h.fetch).toHaveBeenCalledOnce();const [url,init]=h.fetch.mock.calls[0];expect(url).toBe('/api/voice/whatsapp');expect(JSON.parse(String(init.body))).toMatchObject({action:'call',contactId,expectedPeer:'12025550100',confirmed:true,attemptId:h.storage.get(key)});expect(text(render())).not.toMatch(/voice\.whatsapp|undefined/);});
 it('does not turn SDK acceptance into an answered-media label',async()=>{initialize();confirm();await(button('whatsappStart')!.props.onClick as ()=>Promise<void>)();expect(text(render())).toContain(translate('es','voice.whatsappState_initiated'));expect(text(render())).not.toContain(translate('es','voice.whatsappState_connected'));});
 it('prevents a double click from creating two provider attempts',async()=>{initialize();confirm();let resolve:(response:Response)=>void=()=>{};h.fetch.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));const start=button('whatsappStart')!.props.onClick as ()=>Promise<void>;const first=start();const second=start();expect(h.fetch).toHaveBeenCalledOnce();resolve(Response.json({callId:h.storage.get(key),initiated:true}));await Promise.all([first,second]);expect(h.storage.size).toBe(1);});
 it('recovers the same saved attempt after remount without a new POST',async()=>{const id='33333333-3333-4333-8333-333333333333';h.storage.set(key,id);initialize();expect(button('whatsappStart')).toBeUndefined();expect(h.fetch).not.toHaveBeenCalled();await(button('whatsappRecover')!.props.onClick as ()=>Promise<void>)();expect(h.fetch).toHaveBeenCalledExactlyOnceWith('/api/voice/whatsapp?callId='+id,{cache:'no-store',headers:{'x-workspace-id':ws}});expect(h.storage.get(key)).toBe(id);});
 it('retains the attempt after a timeout and only offers status recovery',async()=>{initialize();confirm();h.fetch.mockRejectedValueOnce(new Error('synthetic-timeout'));await(button('whatsappStart')!.props.onClick as ()=>Promise<void>)();const id=h.storage.get(key);expect(id).toBeTruthy();expect(button('whatsappStart')).toBeUndefined();await(button('whatsappRecover')!.props.onClick as ()=>Promise<void>)();expect(h.fetch.mock.calls.map(([,init])=>init.method??'GET')).toEqual(['POST','GET']);expect(h.storage.get(key)).toBe(id);});
 it('refuses a returned receipt for another contact',async()=>{h.storage.set(key,'33333333-3333-4333-8333-333333333333');initialize();h.fetch.mockResolvedValue(Response.json({...receipt(h.storage.get(key)!),contactId:ws}));await(button('whatsappRecover')!.props.onClick as ()=>Promise<void>)();expect(render().some(e=>e.props.role==='alert')).toBe(true);expect(button('whatsappNewCall')).toBeUndefined();});
 it('prepares a new attempt only after an observed terminal receipt and a fresh review',async()=>{h.storage.set(key,'33333333-3333-4333-8333-333333333333');initialize();h.fetch.mockResolvedValue(Response.json({...receipt(h.storage.get(key)!),state:'terminated',status:'completed'}));await(button('whatsappRecover')!.props.onClick as ()=>Promise<void>)();(button('whatsappNewCall')!.props.onClick as ()=>void)();expect(h.storage.has(key)).toBe(false);expect(button('whatsappStart')?.props.disabled).toBe(true);expect(h.fetch).toHaveBeenCalledOnce();});
 it('ignores a response after leaving the selected contact',async()=>{const cleanup=initialize();confirm();let resolve:(response:Response)=>void=()=>{};h.fetch.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));const start=(button('whatsappStart')!.props.onClick as ()=>Promise<void>)();if(typeof cleanup==='function')cleanup();resolve(Response.json({callId:h.storage.get(key),initiated:true}));await start;await tick();expect(text(render())).not.toContain(translate('es','voice.whatsappState_initiated'));});
});
