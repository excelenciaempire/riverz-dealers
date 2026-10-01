import { NextResponse } from 'next/server'
import { inboxSession } from '@/lib/inbox/server-context'
import { automationHistoryId } from '@/lib/automations/history-query'
import { idColumn } from '@/lib/short-id'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

/** Counts for each existing wait scope, computed on all matching rows in SQL. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxSession()
    if (ctx.response) return ctx.response
    const { id } = await params
    if (!automationHistoryId.safeParse(id).success) throw new Error('automation_waiting_not_found')
    const automation = await ctx.db.from('automations').select('id').eq('workspace_id', ctx.workspaceId)
      .eq(idColumn(id), id).is('deleted_at', null).maybeSingle()
    if (automation.error) throw new Error('automation_waiting_unavailable')
    if (!automation.data) throw new Error('automation_waiting_not_found')
    const result = await ctx.db.rpc('automation_waiting_counts', {
      p_workspace_id: ctx.workspaceId, p_automation_id: automation.data.id, p_actor_id: ctx.userId,
    })
    if (result.error?.message?.includes('automation_waiting_not_found')) throw new Error('automation_waiting_not_found')
    if (result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('automation_waiting_unavailable')
    const { counts, total } = result.data as { counts: Record<string, number>; total: number }
    if (!counts || typeof counts !== 'object' || Array.isArray(counts) || !Number.isSafeInteger(total) || total < 0 ||
      Object.entries(counts).some(([key, value]) => !automationHistoryId.safeParse(key).success || !Number.isSafeInteger(value) || value < 1) ||
      Object.values(counts).reduce((sum, value) => sum + value, 0) !== total) throw new Error('automation_waiting_unavailable')
    return NextResponse.json({ counts, total }, { headers })
  } catch (error) {
    const locale = await getLocale()
    if (error instanceof Error && error.message === 'automation_waiting_not_found') return NextResponse.json({ error: translate(locale, 'automations.historyNotFound') }, { status: 404, headers })
    return serverError(error, translate(locale, 'automations.waitingUnavailable'))
  }
}
