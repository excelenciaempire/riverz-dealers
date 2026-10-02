import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({enabled:true,index:0,bank:[] as unknown[],fetch:vi.fn(),expired:vi.fn(),effect:null as null|(()=>void|(()=>void)),storage:new Map<string,string>()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),
 useState:(initial:unknown)=>{const i=h.index++;if(!(i in h.bank))h.bank[i]=initial;return[h.bank[i],(next:unknown)=>{h.bank[i]=typeof next==='function'?next(h.bank[i]):next;}];},
 useRef:(initial:unknown)=>{const i=h.index++;if(!(i in h.bank))h.bank[i]={current:initial};return h.bank[i];},useMemo:(fn:()=>unknown)=>fn(),useEffect:(fn:()=>void|(()=>void))=>{h.effect=fn;},
}));
import { WidgetAddressRequest } from './address-request';
const order='11111111-1111-4111-8111-111111111111';
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(node:React.ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];const item=node as Element;return[item,...nodes(item.props.children as React.ReactNode)];}
function render(locale:'es'|'en'='es'){h.index=0;return WidgetAddressRequest({session:'private-signed',locale,orderId:order,onExpired:h.expired});}
function find(type:string,text?:string,locale:'es'|'en'='es'){const item=nodes(render(locale)).find(value=>value.type===type&&(!text||value.props.children===text));if(!item)throw new Error('Missing '+type+' '+text);return item;}
function click(item:Element){(item.props.onClick as()=>void)();}
function fill(){render();h.bank[0]={address1:'42 Synthetic',address2:'',city:'Synthetic',province:'',zip:'',countryCode:'US'};h.bank[1]=true;}
const ack=(id:string,status='waiting_review')=>new Response(JSON.stringify({id,reference:'#42',created_at:'2026-10-01T12:00:00Z',status,confirmed_at:null,superseded:false}));
beforeEach(()=>{vi.clearAllMocks();h.enabled=true;h.bank=[];h.index=0;h.effect=null;h.storage.clear();vi.stubGlobal('fetch',h.fetch);vi.stubGlobal('sessionStorage',{getItem:(key:string)=>h.storage.get(key)??null,setItem:(key:string,value:string)=>h.storage.set(key,value),removeItem:(key:string)=>h.storage.delete(key)});});
afterEach(()=>vi.unstubAllGlobals());
describe('Structured widget requests show actual execution receipts',()=>{
 it.each(['es','en'] as const)('renders no controls or token outside comparison in %s',locale=>{h.enabled=false;expect(renderToStaticMarkup(render(locale))).toBe('');expect(h.fetch).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('requires address review and sends structured request in %s',async locale=>{
  expect(find('button',locale==='en'?'Request change':'Solicitar cambio',locale).props.disabled).toBe(true);fill();
  h.fetch.mockImplementation(async(_url:string,init:RequestInit)=>ack(JSON.parse(String(init.body)).id));
  click(find('button',locale==='en'?'Request change':'Solicitar cambio',locale));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));
  expect(h.fetch).toHaveBeenCalledOnce();const init=h.fetch.mock.calls[0][1];expect(init.headers.Authorization).toBe('Bearer private-signed');expect(JSON.parse(init.body)).toMatchObject({order_id:order,confirmed:true,locale});
  const html=renderToStaticMarkup(render(locale));expect(html).toContain(locale==='en'?'awaiting review':'pendiente de revisión');expect(html).not.toContain(locale==='en'?'Change confirmed':'Cambio confirmado');expect(html).not.toContain('private-signed');
 });
 it('retains the same ID after an uncertain transport and retries no automatic send',async()=>{
  fill();h.fetch.mockRejectedValueOnce(new Error('Synthetic network failure')).mockImplementation(async(_url:string,init:RequestInit)=>ack(JSON.parse(String(init.body)).id));
  click(find('button','Solicitar cambio'));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.fetch).toHaveBeenCalledOnce();
  click(find('button','Solicitar cambio'));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));
  expect(JSON.parse(h.fetch.mock.calls[0][1].body).id).toBe(JSON.parse(h.fetch.mock.calls[1][1].body).id);
 });
 it('checks receipt status with GET and does not resend the request',async()=>{
  fill();h.fetch.mockImplementationOnce(async(_url:string,init:RequestInit)=>ack(JSON.parse(String(init.body)).id));click(find('button','Solicitar cambio'));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));
  const id=JSON.parse(h.fetch.mock.calls[0][1].body).id;h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({id,reference:'#42',created_at:'2026-10-01T12:00:00Z',status:'confirmed',confirmed_at:'2026-10-01T12:01:00Z',superseded:false})));
  click(find('button','Consultar estado'));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.fetch.mock.calls[1][1].method).toBe('GET');expect(renderToStaticMarkup(render())).toContain('Cambio confirmado el');
 });
 it('recovers an acknowledged receipt after reopening using only an ID hint and authenticated GET',async()=>{
  const id='22222222-2222-4222-8222-222222222222';h.storage.set(`riverz-webchat-order-request:${order}`,id);h.fetch.mockResolvedValueOnce(ack(id));
  render();h.effect?.();await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.fetch).toHaveBeenCalledOnce();expect(h.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer private-signed');
  expect(h.fetch.mock.calls[0][1].body).toBeUndefined();expect(renderToStaticMarkup(render())).toContain('pendiente de revisión');
 });
 it('does not trust a cached ID after access is lost',async()=>{
  const key=`riverz-webchat-order-request:${order}`;h.storage.set(key,'22222222-2222-4222-8222-222222222222');h.fetch.mockResolvedValueOnce(new Response('{}',{status:404}));
  render();h.effect?.();await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.bank[4]).toBeNull();expect(h.storage.has(key)).toBe(false);
 });
 it('rejects a foreign or incoherent receipt and does not show success',async()=>{
  fill();h.fetch.mockResolvedValueOnce(ack(order,'confirmed'));click(find('button','Solicitar cambio'));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.bank[4]).toBeNull();expect(renderToStaticMarkup(render())).not.toContain('Cambio confirmado el');
 });
 it('reports expired session without a success receipt',async()=>{
  fill();h.fetch.mockResolvedValueOnce(new Response('{}',{status:401}));click(find('button','Solicitar cambio'));await vi.waitFor(()=>expect(h.bank[2]).toBe(false));expect(h.expired).toHaveBeenCalledOnce();expect(h.bank[4]).toBeNull();
 });
});
