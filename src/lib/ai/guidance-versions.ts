import { UUID } from '@/lib/inbox/collaboration'
import { MAX_TEXTO_REGLA } from './guidance'
export type GuidanceSnapshot={ titulo:string;cuando:string | null;hacer:string }
export function guidanceSnapshot(raw:unknown):GuidanceSnapshot | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>
  if (Object.keys(v).some(key => !['titulo','cuando','hacer'].includes(key)) || typeof v.titulo!=='string' || !v.titulo.trim() || v.titulo.length>120 || typeof v.hacer!=='string' || !v.hacer.trim() || v.hacer.length>MAX_TEXTO_REGLA || v.cuando!==undefined && v.cuando!==null && (typeof v.cuando!=='string' || v.cuando.length>MAX_TEXTO_REGLA)) return null
  return { titulo:v.titulo.trim(),hacer:v.hacer.trim(),cuando:typeof v.cuando==='string' ? v.cuando.trim() || null : null }
}
export type GuidanceVersionInput=
  | { action:'save';live_revision:number;draft_revision:number;snapshot:GuidanceSnapshot }
  | { action:'publish';live_revision:number;draft_revision:number }
  | { action:'rollback';live_revision:number;target_revision:number }
  | { action:'discard';draft_revision:number }
const revision=(v:unknown,min=1):v is number => typeof v==='number' && Number.isInteger(v) && v>=min && v<2147483647
export function guidanceVersionInput(raw:unknown):GuidanceVersionInput | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>,keys=Object.keys(v).sort().join(',')
  if (v.action==='save' && keys==='action,draft_revision,live_revision,snapshot' && revision(v.live_revision) && revision(v.draft_revision,0)) {
    const snapshot=guidanceSnapshot(v.snapshot);if (snapshot) return { action:'save',live_revision:v.live_revision,draft_revision:v.draft_revision,snapshot }
  }
  if (v.action==='publish' && keys==='action,draft_revision,live_revision' && revision(v.live_revision) && revision(v.draft_revision)) return { action:'publish',live_revision:v.live_revision,draft_revision:v.draft_revision }
  if (v.action==='rollback' && keys==='action,live_revision,target_revision' && revision(v.live_revision) && revision(v.target_revision)) return { action:'rollback',live_revision:v.live_revision,target_revision:v.target_revision }
  if (v.action==='discard' && keys==='action,draft_revision' && revision(v.draft_revision)) return { action:'discard',draft_revision:v.draft_revision }
  return null
}
export function guidanceCreateInput(raw:unknown):({ snapshot:GuidanceSnapshot;agent_id:string | null;draft:boolean } | null) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>
  if (Object.keys(v).some(key => !['titulo','cuando','hacer','agent_id','draft'].includes(key)) || v.draft!==undefined && typeof v.draft!=='boolean' || v.agent_id!==undefined && v.agent_id!==null && v.agent_id!=='' && (typeof v.agent_id!=='string' || !UUID.test(v.agent_id))) return null
  const snapshot=guidanceSnapshot({ titulo:v.titulo,cuando:v.cuando,hacer:v.hacer })
  return snapshot ? { snapshot,agent_id:typeof v.agent_id==='string' && v.agent_id ? v.agent_id : null,draft:v.draft===true } : null
}
export type GuidanceDraft={ rule_id:string;workspace_id:string;base_revision:number;draft_revision:number;state:'draft'|'test';snapshot:GuidanceSnapshot;updated_by:string | null;updated_at:string }
export type GuidanceVersion={ rule_id:string;revision:number;snapshot:GuidanceSnapshot & { activa:boolean;agent_id:string | null;orden:number;origen:string;clave:string | null;deleted?:boolean };actor_id:string | null;source:string;created_at:string }
