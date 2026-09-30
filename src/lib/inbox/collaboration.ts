export const CASE_PRIORITIES = ['normal', 'high', 'urgent'] as const
export const CASE_REASONS = ['purchase', 'delivery', 'payment', 'return', 'other'] as const
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type CasePriority = typeof CASE_PRIORITIES[number]
export type CaseReason = typeof CASE_REASONS[number]
export interface InternalNote { id: string; body: string; author_id: string | null; author_name: string; created_at: string; mentioned_user_ids: string[] }
export interface TeamMember { id: string; name: string }
export interface PresenceMember extends TeamMember { composing: boolean }

type CollaborationAction =
  | { action: 'note'; id: string; body: string; mentions: string[] }
  | { action: 'presence'; session_id: string; composing: boolean; version: number }
  | { action: 'case'; priority: CasePriority; reason: CaseReason | null }

export function collaborationAction(raw: unknown): CollaborationAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (b.action === 'note' && typeof b.id === 'string' && UUID.test(b.id) && typeof b.body === 'string'
    && b.body.trim().length > 0 && b.body.trim().length <= 5000 && Array.isArray(b.mentions)
    && b.mentions.length <= 20 && b.mentions.every(id => typeof id === 'string' && UUID.test(id))) {
    return { action: 'note', id: b.id, body: b.body.trim(), mentions: [...new Set(b.mentions as string[])] }
  }
  if (b.action === 'presence' && typeof b.session_id === 'string' && UUID.test(b.session_id) && typeof b.composing === 'boolean'
    && typeof b.version === 'number' && Number.isSafeInteger(b.version) && b.version > 0) {
    return { action: 'presence', session_id: b.session_id, composing: b.composing, version: b.version }
  }
  if (b.action === 'case' && CASE_PRIORITIES.includes(b.priority as CasePriority)
    && (b.reason === null || CASE_REASONS.includes(b.reason as CaseReason))) {
    return { action: 'case', priority: b.priority as CasePriority, reason: b.reason as CaseReason | null }
  }
  return null
}

export function noteCursor(raw: string | null): { date: string; id: string } | null {
  if (!raw) return null
  const [date, id, extra] = raw.split('|')
  if (extra || !UUID.test(id ?? '') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) return null
  return { date, id }
}
