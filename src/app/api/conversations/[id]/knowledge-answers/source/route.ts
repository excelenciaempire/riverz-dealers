import { NextResponse } from 'next/server'
import { inboxConversation } from '@/lib/inbox/server-context'
import { UUID } from '@/lib/inbox/collaboration'
import { serverError } from '@/lib/api/errors'
export const dynamic='force-dynamic'
type Params={ params:Promise<{ id:string }> }
const headers={ 'Cache-Control':'private, no-store' }
export async function GET(request:Request,{ params }:Params) {
  const { id }=await params,ctx=await inboxConversation(id);if (ctx.response) return ctx.response
  const sourceId=new URL(request.url).searchParams.get('answer_id')
  if (!sourceId || !UUID.test(sourceId)) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400,headers })
  const result=await ctx.client.from('case_gap_answers').select('id,question_snapshot,answer,revision,actor_id,created_at').eq('workspace_id',ctx.workspaceId).eq('conversation_id',id).eq('id',sourceId).maybeSingle()
  if (result.error) return serverError(result.error,ctx.t('evidenceFailed'))
  if (!result.data?.question_snapshot) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404,headers })
  const fresh=await inboxConversation(id);if (fresh.response) return fresh.response
  if (fresh.workspaceId!==ctx.workspaceId || fresh.userId!==ctx.userId) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404,headers })
  // RLS runs again after the fresh access check, including source gap deletion.
  const live=await fresh.client.from('case_gap_answers').select('id').eq('workspace_id',ctx.workspaceId).eq('conversation_id',id).eq('id',sourceId).maybeSingle()
  if (live.error) return serverError(live.error,ctx.t('evidenceFailed'))
  if (!live.data) return NextResponse.json({ error:ctx.t('teamNotFound') },{ status:404,headers })
  return NextResponse.json({ source:result.data,scope:'case_only' },{ headers })
}
