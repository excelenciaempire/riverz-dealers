import type { SupabaseClient } from '@supabase/supabase-js'
import type { AutomationLog } from '@/types'
import { idColumn } from '@/lib/short-id'
import { historyCursor, readHistoryCursor, type AutomationHistoryQuery } from './history-query'

const columns = 'id,automation_id,workspace_id,contact_id,trigger_event,steps_executed,status,error_message,created_at,contact:contacts(id,name,phone)'

export interface AutomationHistoryPage {
  workspace_id: string
  automation: { id: string; name: string }
  logs: AutomationLog[]
  linked_log: AutomationLog | null
  next_cursor: string | null
}

/** Service client reads must always use the trusted workspace and resolved ID. */
export async function loadAutomationHistory(
  db: SupabaseClient,
  workspaceId: string,
  rawId: string,
  input: AutomationHistoryQuery,
): Promise<AutomationHistoryPage> {
  const result = await db.from('automations').select('id,name').eq('workspace_id', workspaceId)
    .eq(idColumn(rawId), rawId).is('deleted_at', null).maybeSingle()
  if (result.error) throw new Error('automation_history_unavailable')
  if (!result.data) throw new Error('automation_history_not_found')
  const automation = result.data as { id: string; name: string }

  const scoped = () => {
    let q = db.from('automation_logs').select(columns).eq('workspace_id', workspaceId).eq('automation_id', automation.id)
    if (input.status) q = q.eq('status', input.status)
    if (input.contact_id) q = q.eq('contact_id', input.contact_id)
    if (input.from) q = q.gte('created_at', input.from)
    if (input.to) q = q.lte('created_at', input.to)
    return q
  }
  let query = scoped().order('created_at', { ascending: false }).order('id', { ascending: false })
  if (input.cursor) {
    const cursor = readHistoryCursor(input.cursor)
    // Both fields are validated before interpolating a PostgREST expression.
    query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
  }
  const page = await query.limit(input.limit + 1)
  if (page.error) throw new Error('automation_history_unavailable')
  const rows = (page.data ?? []) as unknown as AutomationLog[]
  const logs = rows.slice(0, input.limit)
  let linked: AutomationLog | null = null
  if (input.log && !input.cursor && !logs.some(row => row.id === input.log)) {
    const exact = await scoped().eq('id', input.log).maybeSingle()
    if (exact.error) throw new Error('automation_history_unavailable')
    linked = exact.data as unknown as AutomationLog | null
  }
  // An inconsistent legacy FK must not serialize another workspace's contact.
  // RLS isn't available on this service client: verify joined identities too.
  const contactIds = [...new Set([...logs, ...(linked ? [linked] : [])].flatMap(row => row.contact ? [row.contact.id] : []))]
  if (contactIds.length) {
    const contacts = await db.from('contacts').select('id').eq('workspace_id', workspaceId).in('id', contactIds)
    if (contacts.error) throw new Error('automation_history_unavailable')
    const allowed = new Set((contacts.data ?? []).map(row => row.id as string))
    for (const row of [...logs, ...(linked ? [linked] : [])]) {
      if (row.contact && !allowed.has(row.contact.id)) row.contact = undefined
    }
  }
  return {
    workspace_id: workspaceId,
    automation,
    logs,
    linked_log: linked,
    next_cursor: rows.length > input.limit && logs.length ? historyCursor(logs[logs.length - 1]) : null,
  }
}
