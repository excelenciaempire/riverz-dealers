import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { inboxConversation } from '@/lib/inbox/server-context'
import { nativeBlockInput } from '@/lib/inbox/native-block-contract'
import { changeNativeBlock,nativeBlockView,NativeBlockContextError } from '@/lib/inbox/native-block-server'
import { NativeBlockError } from '@/lib/whatsapp/native-block'
import { serverError } from '@/lib/api/errors'
import { limitByKey,rateLimitResponse } from '@/lib/rate-limit'
type Route={ params:Promise<{ id:string }> }
const headers={ 'Cache-Control':'private, no-store' }
function actionError(e:unknown,t:(key:string) => string) {
  if (e instanceof NativeBlockError) return NextResponse.json({ error:t('nativeBlockUnavailable'),code:e.code },{ status:409,headers })
  if (e instanceof NativeBlockContextError) {
    if (e.code.includes('subscription_read_only')) return NextResponse.json({ error:t('orderReadOnly') },{ status:402,headers })
    if (e.code==='native_block_admin') return NextResponse.json({ error:t('nativeBlockAdmin') },{ status:403,headers })
    if (/native_block_changed|native_block_conflict|native_block_locked|invalid_native_block_review/.test(e.code)) return NextResponse.json({ error:t('nativeBlockChanged') },{ status:409,headers })
    if (e.code==='invalid_native_block') return NextResponse.json({ error:t('teamNotFound') },{ status:404,headers })
  }
  return serverError(e,t('nativeBlockUnavailable'))
}
export async function GET(_request:Request,route:Route) {
  const ctx=await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  const limit=await limitByKey(`native-block-read:${ctx.workspaceId}:${ctx.userId}`,{ limit:60,windowMs:300000 })
  if (!limit.success) return rateLimitResponse(limit)
  try {
    const data=await nativeBlockView(ctx)
    const fresh=await inboxConversation(ctx.conversation.id)
    if (fresh.response) return fresh.response
    if (fresh.workspaceId!==ctx.workspaceId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404,headers })
    return NextResponse.json(data,{ headers })
  } catch(e) {
    if (e instanceof NativeBlockError) return NextResponse.json({ available:false,error:ctx.t('nativeBlockUnavailable') },{ headers })
    return actionError(e,ctx.t)
  }
}
export async function POST(request:Request,route:Route) {
  const csrf=await csrfGuard(request);if (csrf) return csrf
  const ctx=await inboxConversation((await route.params).id)
  if (ctx.response) return ctx.response
  if (!ctx.isAdmin) return NextResponse.json({ error:ctx.t('nativeBlockAdmin') },{ status:403,headers })
  const input=nativeBlockInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400,headers })
  const limit=await limitByKey(`native-block-edit:${ctx.workspaceId}:${ctx.userId}`,{ limit:20,windowMs:300000 })
  if (!limit.success) return rateLimitResponse(limit)
  try {
    const data=await changeNativeBlock(ctx,input)
    const fresh=await inboxConversation(ctx.conversation.id)
    if (fresh.response) return fresh.response
    if (fresh.workspaceId!==ctx.workspaceId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404,headers })
    return NextResponse.json(data,{ headers })
  } catch(e) { return actionError(e,ctx.t) }
}
