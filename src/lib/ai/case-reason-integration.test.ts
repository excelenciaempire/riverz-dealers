import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {AiAgent} from './types';
const m=vi.hoisted(()=>({shown:true,rpc:vi.fn(),trace:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown;}}));
vi.mock('@/lib/observability/latitude',()=>({traceTool:m.trace,withLatitudeTrace:vi.fn()}));
import {construirHerramientas} from './runner';
import {runTool} from './tools';
import {toolMode} from './toolbox';
import {agentWithToolContext} from './tool-context';
const id='11111111-1111-4111-8111-111111111111';
const agent={id,workspace_id:id,tools:{clasificar_motivo:'auto'}} as unknown as AiAgent;
const db={rpc:m.rpc} as unknown as SupabaseClient;
const names=(business=agent,available=true,modo:'conversacion'|'borrador'|'comentario'='conversacion')=>construirHerramientas({agent:business,hayContacto:true,shopify:null,otherStore:null,voiceCtx:null,topeDescuento:0,caseReasonAvailable:available,modo}).map(tool=>'name' in tool ? tool.name : undefined);
beforeEach(()=>{vi.clearAllMocks();m.shown=true;m.rpc.mockResolvedValue({data:{status:'recorded',reason:'delivery'},error:null});});
describe('Classification uses the current assistant loop',()=>{
 it('keeps old businesses unchanged and requires comparison, an explicit choice and actual inbound context',()=>{
  expect(toolMode({},'clasificar_motivo')).toBe('off');expect(names({...agent,tools:null})).not.toContain('clasificar_motivo');
  expect(names(agent,false)).not.toContain('clasificar_motivo');expect(names()).toContain('clasificar_motivo');
  m.shown=false;expect(names()).not.toContain('clasificar_motivo');
 });
 it('omits classification from comments, drafts and a restricted channel',()=>{
  expect(names(agent,true,'comentario')).not.toContain('clasificar_motivo');expect(names(agent,true,'borrador')).not.toContain('clasificar_motivo');
  expect(names(agentWithToolContext(agent,'whatsapp',{whatsapp:{clasificar_motivo:'off'}},1))).not.toContain('clasificar_motivo');
 });
 it('dispatches the fixed actual contact without logging the evidence excerpt as tool telemetry',async()=>{
  const input={reason:'delivery',quote:'Where is my order?'};
  expect(JSON.parse(await runTool('clasificar_motivo',input,null,null,{db,workspaceId:id,contactId:id,caseReason:{db,workspaceId:id,agentId:id,conversationId:id,contactId:id,messageId:id}}))).toEqual({ok:true,status:'recorded',reason:'delivery'});
  expect(m.rpc).toHaveBeenCalledOnce();expect(m.trace).not.toHaveBeenCalled();
 });
 it('simulates without real identities, writes or provider calls and rejects a real unbound dispatch',async()=>{
  const input={reason:'delivery',quote:'Where is my order?'};
  expect(JSON.parse(await runTool('clasificar_motivo',input,null,null,{db,workspaceId:id,contactId:'',simulacion:true}))).toEqual({ok:true,simulado:true,reason:'delivery'});
  expect(JSON.parse(await runTool('clasificar_motivo',input,null)).ok).toBe(false);expect(m.rpc).not.toHaveBeenCalled();
 });
});
