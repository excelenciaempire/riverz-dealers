import { UUID } from './collaboration'
export const DISPOSITION_ACTIONS=['read','unread','spam','restore'] as const
export type DispositionAction=typeof DISPOSITION_ACTIONS[number]
export function dispositionInput(raw:unknown):{ id:string; action:DispositionAction; expected_version:number } | null {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null
  const v=raw as Record<string,unknown>
  return Object.keys(v).length===3 && typeof v.id==='string' && UUID.test(v.id) && (DISPOSITION_ACTIONS as readonly unknown[]).includes(v.action) && typeof v.expected_version==='number' && Number.isSafeInteger(v.expected_version) && v.expected_version>=0
    ? { id:v.id,action:v.action as DispositionAction,expected_version:v.expected_version } : null
}
