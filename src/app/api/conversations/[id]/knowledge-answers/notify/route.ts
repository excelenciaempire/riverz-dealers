import { NextResponse } from 'next/server'
import { z } from 'zod'
import { csrfGuard } from '@/lib/csrf'
import { inboxConversation } from '@/lib/inbox/server-context'
import { gapError, gapHeaders } from '@/lib/ai/gap-knowledge-server'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { caseGapNoticesEnabled, notifyCaseGap } from '@/lib/ai/case-gap-notices'
export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }
const input = z.object({ id: z.string().uuid(), gap_id: z.string().uuid() }).strict()
export async function POST(request: Request, { params }: Params) {
  const csrf = await csrfGuard(request); if (csrf) return csrf
  const { id } = await params, ctx = await inboxConversation(id); if (ctx.response) return ctx.response
  const locale = await getLocale(), t = (key: string) => translate(locale, `gaps.${key}`)
  if (!caseGapNoticesEnabled()) return NextResponse.json({ error: t('caseNoticeDisabled') }, { status: 409, headers: gapHeaders })
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: t('invalid') }, { status: 400, headers: gapHeaders })
  const result = await notifyCaseGap({ db: ctx.db, workspaceId: ctx.workspaceId, userId: ctx.userId, conversationId: id, locale }, { id: parsed.data.id, gapId: parsed.data.gap_id })
  if (result.error) {
    const key = result.error.message === 'gap_notice_limit' ? 'caseNoticeLimit' : result.error.message === 'gap_notice_destinations' ? 'caseNoticeDestinations' : result.error.message === 'gap_notice_transport' ? 'caseNoticeTransport' : null
    if (key) return NextResponse.json({ error: t(key) }, { status: 409, headers: gapHeaders })
    return gapError(result.error, t)
  }
  return NextResponse.json({ receipt: result.data }, { headers: gapHeaders })
}
