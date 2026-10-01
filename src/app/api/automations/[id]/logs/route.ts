import { NextResponse } from 'next/server'
import { inboxSession } from '@/lib/inbox/server-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
import { automationHistoryId, parseHistoryQuery } from '@/lib/automations/history-query'
import { loadAutomationHistory } from '@/lib/automations/history'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxSession()
    if (ctx.response) return ctx.response
    const { id } = await params
    if (!automationHistoryId.safeParse(id).success) throw new Error('automation_history_not_found')
    const search = new URL(request.url).searchParams
    if ([...search.keys()].some(key => search.getAll(key).length > 1)) throw new Error('automation_history_invalid')
    const input = parseHistoryQuery(Object.fromEntries(search))
    const page = await loadAutomationHistory(ctx.db, ctx.workspaceId, id, input)
    return NextResponse.json(page, { headers })
  } catch (error) {
    const locale = await getLocale()
    const code = error instanceof Error ? error.message : ''
    if (code === 'automation_history_not_found') return NextResponse.json({ error: translate(locale, 'automations.historyNotFound') }, { status: 404, headers })
    if (code === 'automation_history_invalid') return NextResponse.json({ error: translate(locale, 'automations.historyInvalid') }, { status: 400, headers })
    return serverError(error, translate(locale, 'automations.logsLoadFailed'))
  }
}
