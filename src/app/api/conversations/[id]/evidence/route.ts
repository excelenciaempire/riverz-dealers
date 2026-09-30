import { NextResponse } from 'next/server'
import { inboxConversation } from '@/lib/inbox/server-context'
import { UUID } from '@/lib/inbox/collaboration'
import { serverError } from '@/lib/api/errors'
type Route={ params:Promise<{ id:string }> }
export async function GET(request:Request,route:Route) {
  const ctx=await inboxConversation((await route.params).id);if (ctx.response) return ctx.response
  const id=new URL(request.url).searchParams.get('message_id')
  if (!id || !UUID.test(id)) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  const message=await ctx.db.from('messages').select('id').eq('conversation_id',ctx.conversation.id).eq('id',id).is('deleted_at',null).maybeSingle()
  if (message.error) return serverError(message.error,ctx.t('evidenceFailed'))
  if (!message.data) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
  const [receipts,legacy]=await Promise.all([
    ctx.db.from('ai_turn_evidence').select('id,status,reason,evidence,created_at,inbound_message_id,message_id').eq('workspace_id',ctx.workspaceId).eq('conversation_id',ctx.conversation.id)
      .or(`message_id.eq.${id},inbound_message_id.eq.${id},message_ids.cs.{${id}}`).order('created_at',{ ascending:false }).limit(21),
    ctx.db.from('ai_replies').select('id,status,skip_reason,tools_used,model,created_at').eq('workspace_id',ctx.workspaceId).eq('conversation_id',ctx.conversation.id)
      .eq('message_id',id).order('created_at',{ ascending:false }).limit(21),
  ])
  if (receipts.error || legacy.error) return serverError(receipts.error || legacy.error,ctx.t('evidenceFailed'))
  const fresh=await inboxConversation(ctx.conversation.id);if (fresh.response) return fresh.response
  if (fresh.workspaceId!==ctx.workspaceId || fresh.userId!==ctx.userId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
  const live=await fresh.db.from('messages').select('id').eq('conversation_id',ctx.conversation.id).eq('id',id).is('deleted_at',null).maybeSingle()
  if (live.error) return serverError(live.error,ctx.t('evidenceFailed'))
  if (!live.data) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404 })
  return NextResponse.json({ receipts:(receipts.data ?? []).slice(0,20),legacy:(legacy.data ?? []).slice(0,20),truncated:(receipts.data?.length ?? 0)>20 || (legacy.data?.length ?? 0)>20 },{ headers:{ 'Cache-Control':'private, no-store' } })
}
