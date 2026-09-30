import type { SupabaseClient } from '@supabase/supabase-js'
import { CHANNELS,type Channel } from '@/types'
import { AGENT_TOOLBOX,toolMode,toolSpec,type AgentTools } from './toolbox'
import type { AiAgent } from './types'
export type ToolContextMode='off'|'aprobacion'
export type ToolContextPolicy=Partial<Record<Channel,Record<string,ToolContextMode>>>
/** Contexts may narrow permissions, never enable an action disabled globally. */
export function parseToolContextPolicy(value:unknown):ToolContextPolicy | null {
 if (!value || typeof value!=='object' || Array.isArray(value) || JSON.stringify(value).length>32000) return null
 const policy:ToolContextPolicy={}
 for (const [channel,modes] of Object.entries(value)) {
  if (!CHANNELS.includes(channel as Channel) || !modes || typeof modes!=='object' || Array.isArray(modes)) return null
  const parsed:Record<string,ToolContextMode>={}
  for (const [key,mode] of Object.entries(modes)) {
   const spec=toolSpec(key)
   if (!spec || (mode!=='off' && mode!=='aprobacion') || !spec.modes.includes(mode)) return null
   parsed[key]=mode
  }
  if (Object.keys(parsed).length) policy[channel as Channel]=parsed
 }
 return policy
}
export function agentWithToolContext<T extends { tools?:unknown;permissions?:unknown;puede_crear_pedidos?:boolean|null }>(agent:T,channel:Channel,policy:ToolContextPolicy,revision:number):T & { tools?:unknown;tool_context?:{ channel:Channel;revision:number } } {
 const restrictions=policy[channel]
 if (!restrictions || !Object.keys(restrictions).length) return agent
 const tools:AgentTools={}
 for (const spec of AGENT_TOOLBOX) {
  const global=toolMode(agent,spec.key),local=restrictions[spec.key]
  tools[spec.key]=global==='off' || local==='off' ? 'off' : local==='aprobacion' ? 'aprobacion' : global
 }
 return { ...agent,tools,tool_context:{ channel,revision } }
}
/** A policy read failure must not silently restore automatic action permissions. */
export async function loadAgentToolContext(db:SupabaseClient,agent:AiAgent,channel:Channel):Promise<AiAgent> {
 try {
  const result=await db.from('ai_tool_context_policies').select('revision,policy').eq('workspace_id',agent.workspace_id).eq('agent_id',agent.id).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) return agent
  const policy=parseToolContextPolicy(result.data.policy)
  if (!policy || !Number.isInteger(result.data.revision) || result.data.revision<1) throw new Error('invalid_tool_context')
  return agentWithToolContext(agent,channel,policy,result.data.revision)
 } catch {
  console.warn('[ai] contextual tool permissions were unavailable')
  return { ...agent,tools:Object.fromEntries(AGENT_TOOLBOX.map(spec => [spec.key,'off'])) as AgentTools }
 }
}
