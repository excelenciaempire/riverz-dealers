import { NextResponse } from 'next/server'
import { inboxConversation } from '@/lib/inbox/server-context'
import { changeDisposition } from '@/lib/inbox/disposition-handler'
type Context={ params:Promise<{ id:string }> }
export async function GET(_request:Request,route:Context) {
  const ctx=await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  return NextResponse.json({ manual_unread:ctx.conversation.manual_unread,is_spam:ctx.conversation.is_spam,version:ctx.conversation.inbox_control_version },{ headers:{ 'Cache-Control':'private, no-store' } })
}
export async function POST(request:Request,route:Context) {
  return changeDisposition(request,(await route.params).id)
}
