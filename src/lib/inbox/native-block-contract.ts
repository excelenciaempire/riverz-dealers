import { UUID } from './collaboration'
export type NativeBlockInput={ action:'prepare';id:string;blocked:boolean } | { action:'execute';id:string } | { action:'review';id:string;reason:string }
export function nativeBlockInput(raw:unknown):NativeBlockInput | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>
  if (typeof v.id!=='string' || !UUID.test(v.id)) return null
  const keys=Object.keys(v).sort().join(',')
  if (v.action==='prepare' && keys==='action,blocked,id' && typeof v.blocked==='boolean') return { action:'prepare',id:v.id,blocked:v.blocked }
  if (v.action==='execute' && keys==='action,id') return { action:'execute',id:v.id }
  if (v.action==='review' && keys==='action,id,reason' && typeof v.reason==='string' && v.reason.trim().length>=8 && v.reason.length<=500) return { action:'review',id:v.id,reason:v.reason.trim() }
  return null
}
export type NativeBlockOperation={ id:string;status:'preview'|'running'|'completed'|'failed'|'uncertain'|'reviewed';desired_blocked:boolean;expected_blocked:boolean;created_at:string;updated_at:string;expires_at:string;reviewable:boolean;result:Record<string,unknown> | null;review:Record<string,unknown> | null;preview:{ recipient:string;phone_number_id:string;business_number?:string;contact_name:string;blocked:boolean } }
export type NativeBlockView={ available:boolean;error?:string;is_admin?:boolean;recipient?:string;phone_number_id?:string;business_number?:string;contact_name?:string;blocked?:boolean;operations?:NativeBlockOperation[];active_operation?:NativeBlockOperation | null }
