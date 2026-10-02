import React from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const h=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en',index:0,bank:[] as unknown[],fetch:vi.fn(),job:null as Record<string,unknown>|null}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/hooks/use-workspace',()=>({useWorkspace:()=>({workspace:{id:ws}})}));
vi.mock('@/hooks/use-locale',()=>({useT:()=> (key:string)=>translate(h.locale,key)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({number:(n:number)=>String(n)})}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.fetch}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]=initial;return [h.bank[n],(v:unknown)=>{h.bank[n]=typeof v==='function'?v(h.bank[n]):v;}];},useRef:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]={current:initial};return h.bank[n];},useEffect:()=>{}}));
import {ExternalMigration} from './external-migration';
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(raw:React.ReactNode):Element[]{if(Array.isArray(raw))return raw.flatMap(nodes);if(!React.isValidElement(raw))return [];const e=raw as Element;return [e,...nodes(e.props.children as React.ReactNode)];}
function text(raw:unknown):string{if(Array.isArray(raw))return raw.map(text).join('');if(React.isValidElement(raw))return text((raw as Element).props.children);return typeof raw==='string'?raw:'';}
function render(){h.index=0;return nodes(ExternalMigration({}));}
function field(label:string){const row=render().find(e=>e.type==='label'&&text(e.props.children).startsWith(translate(h.locale,'contacts.'+label)))!;return nodes(row.props.children as React.ReactNode).find(e=>['input','textarea','select'].includes(e.type as string))!;}
function change(label:string,value:string){(field(label).props.onChange as (e:unknown)=>void)({target:{value}});}
const button=(key:string)=>render().find(e=>e.type==='button'&&text(e.props.children)===translate(h.locale,'contacts.'+key))!;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const reply=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{h.enabled=true;h.locale='es';h.index=0;h.bank=[];h.job=null;h.fetch.mockReset().mockImplementation(async(url:string,init:RequestInit)=>{
 if(init.method==='POST'){const body=JSON.parse(String(init.body));if(body.action==='start'){h.job={id:body.input.id,workspace_id:ws,actor_id:actor,source:body.input.source,state:'queued',total:null,collected:0,created_at:'2026-10-02T08:00:00Z',expires_at:'2026-10-02T10:00:00Z',updated_at:'2026-10-02T08:00:00Z',error:null,rows:[],next:null};return reply(h.job);}if(body.action==='cancel'){h.job={...h.job,state:'cancelled',rows:[],next:null};return reply(h.job);}}
 h.job={...h.job,state:'ready',total:1,collected:1,rows:[{sourceId:'42',phone:'+573001112233',name:'Fixture',email:'',company:''}]};return reply(h.job);
});});
describe('External import UI does not import on collection',()=>{
 it('stays invisible and performs no fetch with the gate off',()=>{h.enabled=false;expect(render()).toEqual([]);expect(h.fetch).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('requires account, source and token and clears secrets after collection in %s',async locale=>{
  h.locale=locale;expect(button('nativeStart').props.disabled).toBe(true);change('externalOrigin','https://fixture.kommo.com');change('externalAccount','7');change('nativeToken','FIXTURE_TOKEN');expect(button('nativeStart').props.disabled).toBe(false);
  (button('nativeStart').props.onClick as ()=>void)();await tick();expect(h.fetch).toHaveBeenCalledOnce();expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({action:'start',input:{source:{provider:'kommo',origin:'https://fixture.kommo.com',accountId:7}}});
  expect(button('nativeReview')).toBeUndefined();expect(h.bank).not.toContain('FIXTURE_TOKEN');(button('nativeRefresh').props.onClick as ()=>void)();await tick();expect(button('nativeReview')).toBeDefined();expect(h.fetch.mock.calls.every(call=>!String(call[1].body).includes('confirm'))).toBe(true);
 });
 it('uses an explicit ManyChat selection, fixed API origin and clears IDs after start',async()=>{
  change('migrationProvider','manychat');expect(render().some(e=>e.type==='textarea')).toBe(true);expect(render().some(e=>e.type==='input'&&e.props.type==='url')).toBe(false);
  change('externalAccount','7');change('externalSubscriberIds','42, 43');change('nativeToken','FIXTURE_TOKEN');(button('nativeStart').props.onClick as ()=>void)();await tick();
  expect(JSON.parse(h.fetch.mock.calls[0][1].body).input.source).toEqual({provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[42,43]});expect(h.bank).not.toContain('42, 43');expect(h.bank).not.toContain('FIXTURE_TOKEN');
 });
 it('blocks duplicate ManyChat IDs before network IO',async()=>{
  change('migrationProvider','manychat');change('externalAccount','7');change('externalSubscriberIds','42 42');change('nativeToken','FIXTURE_TOKEN');(button('nativeStart').props.onClick as ()=>void)();await tick();expect(h.fetch).not.toHaveBeenCalled();expect(render().some(e=>e.props.role==='alert')).toBe(true);
 });
 it('cancels extraction independently of any import action',async()=>{
  change('externalOrigin','https://fixture.kommo.com');change('externalAccount','7');change('nativeToken','FIXTURE_TOKEN');(button('nativeStart').props.onClick as ()=>void)();await tick();(button('nativeCancel').props.onClick as ()=>void)();await tick();expect(JSON.parse(h.fetch.mock.calls[1][1].body)).toMatchObject({action:'cancel'});expect(button('nativeReview')).toBeUndefined();
 });
});
