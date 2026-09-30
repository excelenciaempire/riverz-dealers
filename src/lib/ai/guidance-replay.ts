import { UUID } from '@/lib/inbox/collaboration'
export type GuidanceReplayInput={ conversation_id:string;live_revision:number;draft_revision:number }
export type GuidanceReplayResult={ applies:boolean;reply:string;summary:string;conflicts:{ rule_id:string;reason:string }[] }
export function guidanceReplayInput(raw:unknown):GuidanceReplayInput | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>
  if (Object.keys(v).sort().join(',')!=='conversation_id,draft_revision,live_revision' || typeof v.conversation_id!=='string' || !UUID.test(v.conversation_id)
    || typeof v.live_revision!=='number' || !Number.isInteger(v.live_revision) || v.live_revision<1 || v.live_revision>=2147483647
    || typeof v.draft_revision!=='number' || !Number.isInteger(v.draft_revision) || v.draft_revision<0 || v.draft_revision>=2147483647) return null
  return { conversation_id:v.conversation_id,live_revision:v.live_revision,draft_revision:v.draft_revision }
}
/** Only public, bounded observations. Unknown rule references and private reasoning are rejected. */
export function guidanceReplayResult(text:string,peers:readonly string[]):GuidanceReplayResult | null {
  if (text.length>16000) return null
  let raw:unknown
  try { raw=JSON.parse(text) } catch { return null }
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>
  if (Object.keys(v).sort().join(',')!=='applies,conflicts,reply,summary' || typeof v.applies!=='boolean'
    || typeof v.reply!=='string' || !v.reply.trim() || v.reply.length>4000 || typeof v.summary!=='string' || !v.summary.trim() || v.summary.length>1000
    || !Array.isArray(v.conflicts) || v.conflicts.length>10) return null
  const conflicts:GuidanceReplayResult['conflicts']=[],seen=new Set<string>()
  for (const item of v.conflicts) {
    if (!item || typeof item!=='object' || Array.isArray(item) || Object.keys(item).sort().join(',')!=='reason,rule_id'
      || typeof item.rule_id!=='string' || !peers.includes(item.rule_id) || seen.has(item.rule_id)
      || typeof item.reason!=='string' || !item.reason.trim() || item.reason.length>400) return null
    seen.add(item.rule_id);conflicts.push({ rule_id:item.rule_id,reason:item.reason.trim() })
  }
  return { applies:v.applies,reply:v.reply.trim(),summary:v.summary.trim(),conflicts }
}
