import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { widgetOrderText } from '@/lib/channels/webchat/order-contract';
const h=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en',index:0,bank:[] as unknown[],key:'',fetch:vi.fn(),csrf:vi.fn(),prepared:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useLocale:()=>({locale:h.locale}),useT:()=>t}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.csrf}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),
 useState:(initial:unknown)=>{const i=h.index++;if(!(i in h.bank))h.bank[i]=initial;return[h.bank[i],(next:unknown)=>{h.bank[i]=typeof next==='function'?next(h.bank[i]):next;}];},
 useRef:(initial:unknown)=>{const i=h.index++;if(!(i in h.bank))h.bank[i]={current:initial};return h.bank[i];},
 useEffect:(fn:()=>unknown,deps:unknown[])=>{const key=JSON.stringify(deps.slice(0,4));if(key!==h.key){h.key=key;fn();}},
}));
import { CustomerAddressRequests } from './customer-address-requests';
function t(key:string){return widgetOrderText(h.locale,key.replace(/^webchat\./,''));}
const conv='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const address={address1:'42 Synthetic',address2:'',city:'Synthetic',province:'',zip:'',countryCode:'US'};
const page={requests:[{id,order_id:order,contact_id:id,conversation_id:conv,reference:'#42',address,created_at:'2026-10-01T12:00:00Z'}]};
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(node:React.ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];const item=node as Element;return[item,...nodes(item.props.children as React.ReactNode)];}
function render(){h.index=0;return CustomerAddressRequests({conversationId:conv,orderId:order,onPrepared:h.prepared});}
function find(type:string){const value=nodes(render()).find(item=>item.type===type);if(!value)throw new Error('Missing '+type);return value;}
async function open(){(find('details').props.onToggle as(event:unknown)=>void)({currentTarget:{open:true}});render();await vi.waitFor(()=>expect(h.bank[1]).not.toBeNull());}
beforeEach(()=>{vi.clearAllMocks();h.enabled=true;h.locale='es';h.index=0;h.bank=[];h.key='';h.fetch.mockResolvedValue(new Response(JSON.stringify(page)));h.prepared.mockResolvedValue(undefined);h.csrf.mockImplementation(async(_url:string,init:RequestInit)=>new Response(JSON.stringify({operation_id:JSON.parse(String(init.body)).id,order_id:order,request_id:id})));vi.stubGlobal('fetch',h.fetch);});
afterEach(()=>vi.unstubAllGlobals());
describe('Case customer request review is lazy and never executes an order',()=>{
 it.each(['es','en'] as const)('stays hidden outside comparison in %s',locale=>{h.enabled=false;h.locale=locale;expect(renderToStaticMarkup(render())).toBe('');expect(h.fetch).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('loads only after opening and hands preparation to the current approval UI in %s',async locale=>{
  h.locale=locale;render();expect(h.fetch).not.toHaveBeenCalled();await open();expect(renderToStaticMarkup(render())).toContain('42 Synthetic');
  (find('button').props.onClick as()=>void)();await vi.waitFor(()=>expect(h.bank[2]).toBe(false));
  expect(h.prepared).toHaveBeenCalledWith(expect.any(String),id);expect(h.csrf.mock.calls[0][0]).toContain('/customer-address-requests');expect(h.csrf.mock.calls[0][0]).not.toContain('/execute');
 });
 it('retains the preparation ID when the parent cannot reload the reviewed history',async()=>{
  await open();h.prepared.mockRejectedValueOnce(new Error('Synthetic history read failed'));
  (find('button').props.onClick as()=>void)();await vi.waitFor(()=>expect(h.bank[2]).toBe(false));
  (find('button').props.onClick as()=>void)();await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(JSON.parse(h.csrf.mock.calls[0][1].body).id).toBe(JSON.parse(h.csrf.mock.calls[1][1].body).id);
 });
 it('does not pass an unbound result to approval',async()=>{await open();h.csrf.mockResolvedValueOnce(new Response(JSON.stringify({operation_id:id,request_id:order,order_id:order})));(find('button').props.onClick as()=>void)();await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.prepared).not.toHaveBeenCalled();});
});
