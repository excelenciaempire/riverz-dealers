import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',callId='33333333-3333-4333-8333-333333333333';
const h=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en',index:0,bank:[] as unknown[],effects:[] as (()=>void|(()=>void))[],tick:null as null|(()=>void),fetch:vi.fn(),connect:vi.fn(),close:vi.fn(),mute:vi.fn(),job:null as null|Record<string,unknown>,badGrant:false}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.enabled;}}));
vi.mock('@/hooks/use-workspace',()=>({useWorkspace:()=>({workspace:{id:ws}})}));vi.mock('@/hooks/use-locale',()=>({useT:()=> (key:string)=>translate(h.locale,key)}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.fetch}));vi.mock('@/lib/voice/human-audio',()=>({connectHumanAudio:h.connect}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useState:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]=initial;return [h.bank[n],(v:unknown)=>{h.bank[n]=typeof v==='function'?v(h.bank[n]):v;}];},useRef:(initial:unknown)=>{const n=h.index++;if(!(n in h.bank))h.bank[n]={current:initial};return h.bank[n];},useEffect:(effect:()=>void|(()=>void))=>{h.effects.push(effect);}}));
import {HumanVoiceHandoff} from './human-handoff';
type Element=React.ReactElement<Record<string,unknown>>;
function nodes(raw:React.ReactNode):Element[]{if(Array.isArray(raw))return raw.flatMap(nodes);if(!React.isValidElement(raw))return [];const e=raw as Element;return [e,...nodes(e.props.children as React.ReactNode)];}
function text(raw:unknown):string{if(Array.isArray(raw))return raw.map(text).join('');if(React.isValidElement(raw))return text((raw as Element).props.children);return typeof raw==='string'?raw:'';}
function render(){h.index=0;return nodes(HumanVoiceHandoff({callId}));}
const button=(key:string)=>render().find(e=>e.type==='button'&&text(e.props.children)===translate(h.locale,'voice.'+key))!;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const snapshot=()=>({call_id:callId,workspace_id:ws,actor_id:actor,runtime_available:true,job:h.job});
async function initialize(){render();const cleanup=h.effects[0]();await tick();return cleanup;}
async function click(key:string){const node=button(key);expect(node.props.disabled).not.toBe(true);(node.props.onClick as ()=>void)();await tick();}
beforeEach(()=>{
 h.enabled=true;h.locale='es';h.index=0;h.bank=[];h.effects=[];h.tick=null;h.job=null;h.badGrant=false;h.close.mockReset().mockResolvedValue(undefined);h.mute.mockReset().mockResolvedValue(undefined);
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal('setInterval',(fn:()=>void)=>{h.tick=fn;return 1;});vi.stubGlobal('clearInterval',vi.fn());
 h.fetch.mockReset().mockImplementation(async(_url:string,init:RequestInit)=>{
  if(init.method==='POST'){
   const body=JSON.parse(String(init.body)),stamp=new Date().toISOString();
   if(body.action==='request')h.job={id:body.input.id,call_id:callId,workspace_id:ws,actor_id:actor,state:'requested',created_at:stamp,updated_at:stamp,expires_at:new Date(Date.now()+45000).toISOString(),joined_at:null,ended_at:null,reason:null};
   if(body.action==='join')return reply({id:body.input.id,callId:h.badGrant?ws:callId,url:'wss://fixture.livekit.cloud',token:'FIXTURE_NO_MEDIA',customerIdentity:'caller-'+callId,expiresAt:new Date(Date.now()+30000).toISOString()});
   if(body.action==='end')h.job={...h.job,state:'ended',ended_at:stamp,updated_at:stamp,reason:'ended_by_human'};
  }
  return reply(snapshot());
 });
 h.connect.mockReset().mockResolvedValue({close:h.close,mute:h.mute});
});
afterEach(()=>{vi.unstubAllGlobals();});
describe('Human takeover UI does not request media implicitly',()=>{
 it('has no UI, network or microphone work with the flag off',async()=>{h.enabled=false;expect(render()).toEqual([]);h.effects[0]();await tick();expect(h.fetch).not.toHaveBeenCalled();expect(h.connect).not.toHaveBeenCalled();});
 it.each(['es','en'] as const)('separates request, worker readiness and explicit microphone entry in %s',async locale=>{
  h.locale=locale;const cleanup=await initialize();expect(button('handoffRequest').props.disabled).toBe(false);expect(h.connect).not.toHaveBeenCalled();await click('handoffRequest');expect(h.connect).not.toHaveBeenCalled();expect(button('handoffJoin')).toBeUndefined();
  h.job={...h.job,state:'ready'};h.tick!();await tick();expect(button('handoffJoin')).toBeDefined();expect(h.connect).not.toHaveBeenCalled();await click('handoffJoin');expect(h.connect).toHaveBeenCalledOnce();expect(button('handoffMute')).toBeDefined();await click('handoffMute');expect(h.mute).toHaveBeenCalledWith(true);await click('handoffEnd');expect(h.close).toHaveBeenCalledOnce();expect(button('handoffJoin')).toBeUndefined();if(typeof cleanup==='function')cleanup();
 });
 it('rejects a credential for another call before touching audio',async()=>{await initialize();await click('handoffRequest');h.job={...h.job,state:'ready'};h.tick!();await tick();h.badGrant=true;await click('handoffJoin');expect(h.connect).not.toHaveBeenCalled();expect(render().some(e=>e.props.role==='alert')).toBe(true);expect(h.fetch.mock.calls.some(([,init])=>String(init.body).includes('"end"'))).toBe(true);});
 it('closes its microphone and releases its own lease when leaving the call view',async()=>{const cleanup=await initialize();await click('handoffRequest');h.job={...h.job,state:'ready'};h.tick!();await tick();await click('handoffJoin');if(typeof cleanup==='function')cleanup();await tick();expect(h.close).toHaveBeenCalledOnce();expect(h.fetch.mock.calls.some(([,init])=>String(init.body).includes('"end"'))).toBe(true);});
});
