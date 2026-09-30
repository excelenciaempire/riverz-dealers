import { NextResponse } from 'next/server'
import { inboxConversation } from '@/lib/inbox/server-context'
import { serverError } from '@/lib/api/errors'
import { exportConversation,ConversationExportLimit } from '@/lib/inbox/conversation-export'
import { getLocale } from '@/lib/i18n/server'
import { limitByKey,rateLimitResponse } from '@/lib/rate-limit'
type Context={ params:Promise<{ id:string }> }
export async function GET(_request:Request,route:Context) {
  const ctx=await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const limit=await limitByKey(`case-export:${ctx.workspaceId}:${ctx.userId}`,{ limit:5,windowMs:300000 })
  if (!limit.success) return rateLimitResponse(limit)
  try {
    const result=await exportConversation(ctx.db,{ workspaceId:ctx.workspaceId,conversationId:ctx.conversation.id,channel:ctx.conversation.channel,locale:await getLocale() })
    const fresh=await inboxConversation(ctx.conversation.id)
    if (fresh.response) return fresh.response
    if (fresh.workspaceId!==ctx.workspaceId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
    return new Response(result.archive,{ headers:{ 'Content-Type':'application/zip','Content-Disposition':`attachment; filename="riverz-conversation-${ctx.conversation.id}.zip"`,
      'Cache-Control':'private, no-store','X-Export-Messages':String(result.messages),'X-Export-Files':String(result.files),'X-Export-Missing':String(result.missing),'X-Content-Type-Options':'nosniff' } })
  } catch(e) {
    if (e instanceof ConversationExportLimit) return NextResponse.json({ error:ctx.t('exportLimit') },{ status:413 })
    return serverError(e,ctx.t('exportFailed'))
  }
}
