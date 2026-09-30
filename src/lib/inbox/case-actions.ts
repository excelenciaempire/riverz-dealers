import { CASE_PRIORITIES, CASE_REASONS, UUID, type CasePriority, type CaseReason } from './collaboration'

type Deadline = { until: string } | { minutes: number }
type ReminderDeadline = { due_at: string } | { minutes: number }
export type InboxAction =
  | ({ type: 'snooze' } & Deadline)
  | { type: 'resume' }
  | ({ type: 'reminder'; body: string } & ReminderDeadline)
  | { type: 'cancel_reminder'; id: string }
  | { type: 'note'; body: string; mentions: string[] }
  | { type: 'case'; priority: CasePriority; reason: CaseReason | null }
  | { type: 'tag'; tag_id: string }
  | { type: 'assign'; agent_ids?: string[]; team_id?: string }
export interface InboxMacro { id: string; name: string; actions: InboxAction[]; version: number; is_active: boolean; created_by: string }
export interface InboxActionResult { type: InboxAction['type']; id?: string; until?: string; due_at?: string; agent_id?: string; priority?: CasePriority; reason?: CaseReason | null; tag_id?: string }
export interface InboxReminder { id: string; due_at: string; body: string; status: 'pending' | 'completed' | 'cancelled' }

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const only = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).every(k => keys.includes(k))
const uuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x)
const boundedText = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max
const uuidArray = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length <= max && x.every(uuid)

/** Absolute instants must include a timezone; local datetime inputs are converted by the UI. */
export function followupDate(raw: unknown, now = Date.now()): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null
  const [year, month, day, hour, minute, second] = raw.slice(0, 19).split(/[-T:]/).map(Number)
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) && ms > now && ms <= now + 365 * 86400000 ? new Date(ms).toISOString() : null
}

/** Single parser shared by manual commands, saved macros and bulk previews. */
export function inboxActions(raw: unknown, options: { macro?: boolean; now?: number } = {}): InboxAction[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) return null
  const actions: InboxAction[] = []
  for (const a of raw) {
    if (!object(a)) return null
    switch (a.type) {
      case 'resume':
        if (!only(a, ['type'])) return null
        actions.push({ type: 'resume' }); break
      case 'snooze':
      case 'reminder': {
        const reminder = a.type === 'reminder'
        const dateKey = reminder ? 'due_at' : 'until'
        if (!only(a, ['type', dateKey, 'minutes', ...(reminder ? ['body'] : [])]) || (reminder && !boundedText(a.body, 1000))) return null
        if (options.macro) {
          if (a[dateKey] !== undefined || !Number.isInteger(a.minutes) || Number(a.minutes) < 1 || Number(a.minutes) > 43200) return null
          actions.push(reminder ? { type: 'reminder', minutes: Number(a.minutes), body: (a.body as string).trim() } : { type: 'snooze', minutes: Number(a.minutes) })
        } else {
          const date = followupDate(a[dateKey], options.now)
          if (!date || a.minutes !== undefined) return null
          actions.push(reminder ? { type: 'reminder', due_at: date, body: (a.body as string).trim() } : { type: 'snooze', until: date })
        }
        break
      }
      case 'cancel_reminder':
        if (options.macro || !only(a, ['type', 'id']) || !uuid(a.id)) return null
        actions.push({ type: 'cancel_reminder', id: a.id }); break
      case 'note':
        if (!only(a, ['type', 'body', 'mentions']) || !boundedText(a.body, 5000) || !uuidArray(a.mentions ?? [], 20)) return null
        actions.push({ type: 'note', body: a.body.trim(), mentions: [...new Set((a.mentions ?? []) as string[])] }); break
      case 'case':
        if (!only(a, ['type', 'priority', 'reason']) || !CASE_PRIORITIES.includes(a.priority as CasePriority) || (a.reason !== null && !CASE_REASONS.includes(a.reason as CaseReason))) return null
        actions.push({ type: 'case', priority: a.priority as CasePriority, reason: a.reason as CaseReason | null }); break
      case 'tag':
        if (!only(a, ['type', 'tag_id']) || !uuid(a.tag_id)) return null
        actions.push({ type: 'tag', tag_id: a.tag_id }); break
      case 'assign':
        if (!only(a, ['type', 'team_id', 'agent_ids']) || (a.team_id !== undefined && a.agent_ids !== undefined)) return null
        if (uuid(a.team_id)) actions.push({ type: 'assign', team_id: a.team_id })
        else if (uuidArray(a.agent_ids, 100) && a.agent_ids.length) actions.push({ type: 'assign', agent_ids: [...new Set(a.agent_ids)] })
        else return null
        break
      default: return null
    }
  }
  return actions
}

export function conversationIsSnoozed(c: { snoozed_until?: string | null }, now = Date.now()): boolean {
  return !!c.snoozed_until && Date.parse(c.snoozed_until) > now
}
