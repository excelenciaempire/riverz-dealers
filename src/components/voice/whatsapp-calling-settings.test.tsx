import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const ws='11111111-1111-4111-8111-111111111111';
const h=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en',index:0,bank:[] as unknown[],effects:[] as (()=>void|(()=>void))[],fetch:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=> (key:string)=>translate(h.locale,key)}));vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.fetch}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]=initial;return [h.bank[n],(value:unknown)=>{h.bank[n]=typeof value==='function'?value(h.bank[n]):value;}];},useRef:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]={current:initial};return h.bank[n];},useEffect:(effect:()=>void|(()=>void))=>{h.effects.push(effect);}}));
import {WhatsAppCallingSettings} from './whatsapp-calling-settings';
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(raw:React.ReactNode):Element[]{if(Array.isArray(raw))return raw.flatMap(nodes);if(!React.isValidElement(raw))return [];const e=raw as Element;return [e,...nodes(e.props.children as React.ReactNode)];}
function text(raw:unknown):string{if(Array.isArray(raw))return raw.map(text).join('');if(React.isValidElement(raw))return text((raw as Element).props.children);return typeof raw==='string'?raw:'';}
function render(){h.index=0;return nodes(WhatsAppCallingSettings({workspaceId:ws}));}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function initialize(){render();h.effects[0]();await tick();}
const defaults={inboundEnabled:false,outboundEnabled:false,apiVersion:'26.0',ratesConfigured:{inbound:true,outbound:true}};
beforeEach(()=>{h.enabled=true;h.locale='es';h.index=0;h.bank=[];h.effects=[];h.fetch.mockReset().mockImplementation(async()=>Response.json(defaults));});
afterEach(()=>vi.unstubAllGlobals());
describe('Private opt-in WhatsApp calling settings',()=>{
 it('makes no network call or visual changes in the public stage',async()=>{h.enabled=false;expect(render()).toEqual([]);h.effects[0]();await tick();expect(h.fetch).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('keeps directions off until saved in %s',async locale=>{h.locale=locale;await initialize();const boxes=render().filter(e=>e.type==='input');expect(boxes.map(e=>e.props.checked)).toEqual([false,false]);(boxes[0].props.onChange as (event:unknown)=>void)({target:{checked:true}});const save=render().find(e=>typeof e.props.onClick==='function')!;await(save.props.onClick as ()=>Promise<void>)();const [,init]=h.fetch.mock.calls[1];expect(JSON.parse(String(init.body))).toEqual({action:'settings',input:{inboundEnabled:true,outboundEnabled:false,apiVersion:'26.0'}});expect(text(render())).not.toMatch(/voice\.whatsapp/);expect(h.fetch).toHaveBeenCalledTimes(2);});
 it('does not enable a direction with an unknown usage rate',async()=>{h.fetch.mockResolvedValue(Response.json({...defaults,ratesConfigured:{inbound:false,outbound:true}}));await initialize();expect(render().filter(e=>e.type==='input').map(e=>e.props.disabled)).toEqual([true,false]);expect(text(render())).toContain(translate('es','voice.whatsappRatesUnavailable'));});
 it('still allows a previously enabled direction to be turned off if its rate is absent',async()=>{h.fetch.mockResolvedValue(Response.json({...defaults,inboundEnabled:true,ratesConfigured:{inbound:false,outbound:true}}));await initialize();expect(render().filter(e=>e.type==='input')[0].props.disabled).toBe(false);});
 it('fails closed on malformed settings without offering mutation controls',async()=>{h.fetch.mockResolvedValue(Response.json({inboundEnabled:'true'}));await initialize();expect(render().filter(e=>e.type==='input')).toEqual([]);expect(render().some(e=>e.props.role==='alert')).toBe(true);});
});
