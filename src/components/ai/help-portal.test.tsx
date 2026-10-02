import React from 'react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
import type {DocumentSource} from '@/lib/ai/document-contract';
const ws='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',sourceId='44444444-4444-4444-8444-444444444444',articleId='55555555-5555-4555-8555-555555555555';
const h=vi.hoisted(()=>({enabled:true,index:0,bank:[] as unknown[],locale:'es' as 'es'|'en',fetch:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/hooks/use-workspace',()=>({useWorkspace:()=>({workspace:{id:ws}})}));
vi.mock('@/hooks/use-locale',()=>({useT:()=> (key:string)=>translate(h.locale,key)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({number:(n:number)=>String(n)})}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.fetch}));
vi.mock('@/components/ui/button',()=>({Button:'button'}));
vi.mock('@/components/ui/textarea',()=>({Textarea:'textarea'}));
vi.mock('@/components/i18n/locale-link',()=>({default:'a'}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),
 useState:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]=initial;return [h.bank[n],(value:unknown)=>{h.bank[n]=typeof value==='function'?value(h.bank[n]):value;}];},
 useRef:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]={current:initial};return h.bank[n];},useEffect:()=>{},
}));
import {HelpPortalManager} from './help-portal';
const source:DocumentSource={id:sourceId,name:'Policy.docx',format:'docx',bytes:100,sha256:'a'.repeat(64),text:'Returns within 30 days.',status:'active',revision:2,updated_at:'2026-10-02T00:00:00Z'};
const portal={id,workspace_id:ws,agent_id:agent,slug:'fixture-shop',brand:{name:'Fixture',description:'Help',accent:'#123456'},revision:1,published:true,
 articles:[{id:articleId,portal_id:id,source_id:sourceId,source_revision:2,title:'Returns',body:source.text,locale:'en',revision:1,status:'draft',updated_at:'2026-10-02T00:00:00Z'}]};
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(raw:React.ReactNode):Element[]{if(Array.isArray(raw))return raw.flatMap(nodes);if(!React.isValidElement(raw))return [];const node=raw as Element;return [node,...nodes(node.props.children as React.ReactNode)];}
function content(raw:unknown):string{if(Array.isArray(raw))return raw.map(content).join('');if(React.isValidElement(raw))return content((raw as Element).props.children);return typeof raw==='string'?raw:'';}
function render(sources=[source]){h.index=0;return nodes(HelpPortalManager({agentId:agent,sources}));}
const button=(key:string,sources=[source])=>render(sources).find(row=>row.type==='button'&&content(row.props.children)===translate(h.locale,`assistant.${key}`))!;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function loaded(){const details=render().find(row=>row.type==='details')!;(details.props.onToggle as (event:unknown)=>void)({stopPropagation(){},currentTarget:{open:true}});await tick();}
function choose(){const row=render().find(item=>item.type==='button'&&content(item.props.children).startsWith('Returns · '))!;(row.props.onClick as ()=>void)();}
beforeEach(()=>{vi.clearAllMocks();h.index=0;h.bank=[];h.enabled=true;h.locale='es';h.fetch.mockResolvedValue(new Response(JSON.stringify({portal}),{status:200,headers:{'Content-Type':'application/json'}}));});
describe('Portal review client gates',()=>{
 it('renders no new UI with the feature off',()=>{h.enabled=false;expect(render()).toEqual([]);expect(h.fetch).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('requires saved exact source/version and an explicit checkbox before publish in %s',async locale=>{
  h.locale=locale;await loaded();choose();let publish=button('portalPublish');expect(publish.props.disabled).toBe(true);(publish.props.onClick as ()=>void)();expect(h.fetch).toHaveBeenCalledTimes(1);
  const review=render().find(row=>row.type==='input'&&row.props.type==='checkbox'&&row.props.disabled===false&&row.props.checked===false)!;
  (review.props.onChange as (event:unknown)=>void)({target:{checked:true}});publish=button('portalPublish');expect(publish.props.disabled).toBe(false);
  expect(button('portalPublish',[{...source,revision:3}]).props.disabled).toBe(true);
  const text=render().find(row=>row.type==='textarea')!;(text.props.onChange as (event:unknown)=>void)({target:{value:'Changed draft'}});expect(button('portalPublish').props.disabled).toBe(true);
 });
 it('clears article text and review when the private editor closes',async()=>{
  await loaded();choose();const details=render().find(row=>row.type==='details')!;(details.props.onToggle as (event:unknown)=>void)({stopPropagation(){},currentTarget:{open:false}});
  expect(render().find(row=>row.type==='textarea')?.props.value).toBe('');expect(render().filter(row=>row.type==='input'&&row.props.type==='checkbox'&&row.props.checked===true)).toHaveLength(1);
 });
});
