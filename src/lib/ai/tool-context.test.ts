import { describe,expect,it,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { agentWithToolContext,loadAgentToolContext,parseToolContextPolicy } from './tool-context'
import { herramientasQueRequierenAprobacion,toolMode } from './toolbox'
import type { AiAgent } from './types'
import { construirHerramientas } from './runner'
const agent={ id:'11111111-1111-4111-8111-111111111111',workspace_id:'22222222-2222-4222-8222-222222222222',tools:{ crear_pedido:'auto',editar_pedido:'off',reembolsar:'aprobacion',lookup_order:'auto' },permissions:null } as unknown as AiAgent
function database(data:unknown,error:unknown=null) {
 const single=vi.fn().mockResolvedValue({ data,error }),eq=vi.fn(),q={ select:vi.fn(),eq,maybeSingle:single },from=vi.fn().mockReturnValue(q);q.select.mockReturnValue(q);eq.mockReturnValue(q)
 return { db:{ from } as unknown as SupabaseClient,from,eq,single }
}
describe('contextual tool restrictions preserve global permissions and financial approvals',() => {
 it('removes restricted tools from the actual conversational and comment constructors while preserving approval routing',() => {
  const restricted=agentWithToolContext(agent,'ig_comment',{ ig_comment:{ crear_pedido:'aprobacion',lookup_order:'off' } },2)
  for (const modo of ['conversacion','comentario'] as const) {
   const tools=construirHerramientas({ agent:restricted,hayContacto:true,shopify:{ config:null,canCreateOrders:true } as never,otherStore:null,voiceCtx:null,topeDescuento:0,modo })
   const names=tools.map(t => 'name' in t ? t.name : undefined)
   expect(names).not.toContain('lookup_order');expect(names).toContain('create_order')
  }
  expect(herramientasQueRequierenAprobacion(restricted)).toContain('crear_pedido')
  const blocked=agentWithToolContext(agent,'ig_comment',{ ig_comment:{ crear_pedido:'off' } },3)
  expect(construirHerramientas({ agent:blocked,hayContacto:true,shopify:{ config:null,canCreateOrders:true } as never,otherStore:null,voiceCtx:null,topeDescuento:0 }).map(t => 'name' in t ? t.name : undefined)).not.toContain('create_order')
 })
 it('preserves the original agent and behavior when no restriction applies',() => {
  expect(agentWithToolContext(agent,'whatsapp',{},1)).toBe(agent);expect(agentWithToolContext(agent,'whatsapp',{ ig_comment:{ crear_pedido:'off' } },1)).toBe(agent)
 })
 it('narrows one channel without mutating the globally configured tools or another channel',() => {
  const policy={ ig_comment:{ crear_pedido:'aprobacion',lookup_order:'off' } } as const,a=agentWithToolContext(agent,'ig_comment',policy,3)
  expect(toolMode(a,'crear_pedido')).toBe('aprobacion');expect(toolMode(a,'lookup_order')).toBe('off');expect(toolMode(agentWithToolContext(agent,'whatsapp',policy,3),'crear_pedido')).toBe('auto');expect(agent.tools?.crear_pedido).toBe('auto');expect(a.tool_context).toEqual({ channel:'ig_comment',revision:3 })
 })
 it('cannot enable a globally disabled action or remove an existing financial approval',() => {
  const a=agentWithToolContext(agent,'voice',{ voice:{ editar_pedido:'aprobacion',reembolsar:'aprobacion' } },2)
  expect(toolMode(a,'editar_pedido')).toBe('off');expect(toolMode(a,'reembolsar')).toBe('aprobacion');expect(herramientasQueRequierenAprobacion(a)).not.toContain('reembolsar')
 })
 it('rejects unknown channels, tools, automatic overrides and meaningless read approvals',() => {
  for (const value of [null,[],{ unknown:{ crear_pedido:'off' } },{ whatsapp:{ unknown:'off' } },{ whatsapp:{ crear_pedido:'auto' } },{ whatsapp:{ lookup_order:'aprobacion' } },{ whatsapp:{ reembolsar:'auto' } },{ whatsapp:[] },{ whatsapp:{ crear_pedido:true } }]) expect(parseToolContextPolicy(value)).toBeNull()
  expect(parseToolContextPolicy({ whatsapp:{},voice:{ crear_pedido:'aprobacion' } })).toEqual({ voice:{ crear_pedido:'aprobacion' } })
 })
 it('loads only this assistant’s policy in its own business and applies the current revision',async() => {
  const f=database({ revision:4,policy:{ ig_comment:{ crear_pedido:'off' } } }),a=await loadAgentToolContext(f.db,agent,'ig_comment');expect(toolMode(a,'crear_pedido')).toBe('off');expect(a.tool_context?.revision).toBe(4);expect(f.eq.mock.calls).toEqual([['workspace_id',agent.workspace_id],['agent_id',agent.id]])
 })
 it('keeps absent policies compatible and fails closed on errors or malformed configuration without retrying',async() => {
  const empty=database(null);expect(await loadAgentToolContext(empty.db,agent,'whatsapp')).toBe(agent)
  const warn=vi.spyOn(console,'warn').mockImplementation(() => {})
  try { for (const f of [database(null,{ message:'private schema' }),database({ revision:0,policy:{} }),database({ revision:2,policy:{ whatsapp:{ reembolsar:'auto' } } })]) { const a=await loadAgentToolContext(f.db,agent,'whatsapp');expect(toolMode(a,'crear_pedido')).toBe('off');expect(toolMode(a,'lookup_order')).toBe('off');expect(f.single).toHaveBeenCalledTimes(1) };expect(warn.mock.calls.every(call => call[0]==='[ai] contextual tool permissions were unavailable')).toBe(true) } finally { warn.mockRestore() }
 })
})
