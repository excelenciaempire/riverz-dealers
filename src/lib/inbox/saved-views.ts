import { CHANNELS, type Channel, type Conversation } from '@/types'
import { actionableUnreadCount } from './actionable-unread'
import { conversationIsSnoozed } from './case-actions'
import { CASE_PRIORITIES, CASE_REASONS, UUID, type CasePriority, type CaseReason } from './collaboration'

export interface SavedViewConfig {
  channel?: Channel; status?: 'unread' | 'unassigned' | 'mine' | 'open' | 'pending' | 'closed' | 'snoozed';
  assigned_agent_id?: string; case_priority?: CasePriority; case_reason?: CaseReason
}
export interface SavedView { id: string; name: string; config: SavedViewConfig; is_shared: boolean; user_id: string; count: number | null; supported: boolean }

/** Unknown legacy filters remain stored; never claim their count from a partial interpretation. */
export function savedViewConfig(raw: unknown): SavedViewConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (Object.keys(b).some(key => !['channel', 'status', 'assigned_agent_id', 'case_priority', 'case_reason'].includes(key))) return null
  if (b.channel !== undefined && !CHANNELS.includes(b.channel as Channel)) return null
  if (b.status !== undefined && !['unread', 'unassigned', 'mine', 'open', 'pending', 'closed', 'snoozed'].includes(String(b.status))) return null
  if (b.assigned_agent_id !== undefined && (typeof b.assigned_agent_id !== 'string' || !UUID.test(b.assigned_agent_id))) return null
  if (b.case_priority !== undefined && !CASE_PRIORITIES.includes(b.case_priority as CasePriority)) return null
  if (b.case_reason !== undefined && !CASE_REASONS.includes(b.case_reason as CaseReason)) return null
  if (['mine', 'unassigned'].includes(String(b.status)) && b.assigned_agent_id !== undefined) return null
  return { ...b } as SavedViewConfig
}

export function conversationMatchesView(conversation: Conversation, config: SavedViewConfig, currentUserId: string, now = Date.now()): boolean {
  const snoozed = conversationIsSnoozed(conversation, now)
  if (config.status === 'snoozed' ? !snoozed : snoozed) return false
  if (config.channel && conversation.channel !== config.channel) return false
  if (config.case_priority && (conversation.case_priority ?? 'normal') !== config.case_priority) return false
  if (config.case_reason && conversation.case_reason !== config.case_reason) return false
  if (config.assigned_agent_id && conversation.assigned_agent_id !== config.assigned_agent_id) return false
  if (config.status === 'snoozed') return true
  if (config.status === 'mine') return conversation.assigned_agent_id === currentUserId
  if (config.status === 'unassigned') return !conversation.assigned_agent_id
  if (config.status === 'unread') return actionableUnreadCount(conversation) > 0
  if (config.status && conversation.status !== config.status) return false
  return true
}
