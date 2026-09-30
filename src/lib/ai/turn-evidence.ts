import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { UUID } from '@/lib/inbox/collaboration'
import { redactModelSecrets } from '@/lib/security/model-secrets'
import type { SourceObservation,ToolObservation,TurnEvidence } from './turn-evidence-contract'
type State={ id:string;agentId:string | null;evidence:TurnEvidence;status:'sent'|'skipped'|'failed'|'unknown';messageId:string | null;messageIds:string[];reason:string | null }
const scope=new AsyncLocalStorage<State>()
export async function withTurnEvidence<T>(fn:() => Promise<T>,save:(state:State) => Promise<void>):Promise<T> {
  const state:State={ id:randomUUID(),agentId:null,evidence:{ version:1,rules:[],sources:[],tools:[],truncated:false },status:'unknown',messageId:null,messageIds:[],reason:null }
  return scope.run(state,async() => {
    try { return await fn() }
    finally { if (state.evidence.rules.length || state.evidence.sources.length || state.evidence.tools.length) await save(state) }
  })
}
export function observeContext(agentId:string,rules:{ id:string;live_revision?:number;titulo:string }[],sources:SourceObservation[]) {
  const state=scope.getStore();if (!state) return
  try {
    state.agentId=UUID.test(agentId) ? agentId : null
    state.evidence.rules=rules.filter(rule => rule && UUID.test(rule.id)).slice(0,50).map(rule => ({ id:rule.id,revision:Number.isInteger(rule.live_revision) && rule.live_revision!>0 ? rule.live_revision! : null,title:redactModelSecrets(typeof rule.titulo==='string' ? rule.titulo : '').slice(0,120) }))
    state.evidence.sources=sources.filter(source => source && UUID.test(source.id)).slice(0,100).map(source => ({ kind:source.kind,id:source.id,...(typeof source.title==='string' && source.title ? { title:redactModelSecrets(source.title).slice(0,120) } : {}) }))
    if (rules.length>50 || sources.length>100) state.evidence.truncated=true
  } catch { state.evidence.truncated=true }
}
/** A tool response is evidence of a response, not proof of a business effect. */
export function publicToolStatus(raw:string):ToolObservation['status'] {
  if (typeof raw!=='string' || raw.length>1000000) return 'unverified'
  let data:unknown;try { data=JSON.parse(raw) } catch { return 'unverified' }
  if (!data || typeof data!=='object' || Array.isArray(data)) return 'returned'
  const v=data as Record<string,unknown>
  if (v.ok===false || v.success===false || v.error) return 'reported_error'
  if (v.estado==='pendiente_de_aprobacion' || v.status==='awaiting_approval') return 'approval_requested'
  if (v.status==='uncertain' || v.confirmed===false || v.simulado===true) return 'unverified'
  return 'returned'
}
export function observeTool(name:string,kind:ToolObservation['kind'],status:ToolObservation['status']):ToolObservation | null {
  const state=scope.getStore();if (!state || !/^[a-zA-Z0-9_]{1,80}$/.test(name)) return null
  if (state.evidence.tools.length>=100) { state.evidence.truncated=true;return null }
  const record:ToolObservation={ name,kind,status,sequence:state.evidence.tools.length+1 };state.evidence.tools.push(record);return record
}
export function observeOutcome(status:State['status'],messageId?:string | null,reason?:string) {
  const state=scope.getStore();if (!state) return
  state.status=status
  if (messageId && UUID.test(messageId)) { state.messageId=messageId;observeMessages([messageId]) }
  state.reason=reason && /^[a-z0-9_]{1,100}$/.test(reason) ? reason : null
}
export function observeMessages(ids:readonly string[]) {
  const state=scope.getStore();if (!state) return
  const unique=[...new Set([...state.messageIds,...ids.filter(id => UUID.test(id))])]
  state.messageIds=unique.slice(0,100);if (unique.length>100) state.evidence.truncated=true
}
/** Evidence failure must never repeat a tool or turn an already sent reply into a failed one. */
export async function saveTurnEvidence(db:SupabaseClient,context:{ workspaceId:string;conversationId:string;inboundId:string | null },state:State) {
  try {
    const { error }=await db.rpc('record_ai_turn_evidence',{ p_id:state.id,p_workspace_id:context.workspaceId,p_conversation_id:context.conversationId,
      p_inbound_id:context.inboundId,p_message_id:state.messageId,p_message_ids:state.messageIds,p_agent_id:state.agentId,p_status:state.status,p_reason:state.reason,p_evidence:state.evidence })
    if (error) console.error('[ai] turn evidence could not be recorded',error.code ?? 'unavailable')
  } catch { console.error('[ai] turn evidence could not be recorded') }
}
