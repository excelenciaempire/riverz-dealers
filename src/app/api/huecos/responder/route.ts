import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { gapSession,gapError,gapHeaders } from '@/lib/ai/gap-knowledge-server'
import { gapKnowledgeInput } from '@/lib/ai/gap-knowledge'
import { prepareGapKnowledgeReview } from '@/lib/ai/gap-knowledge-actions'
export const dynamic='force-dynamic'
export async function POST(request:Request) {
 const csrf=await csrfGuard(request);if (csrf) return csrf
 const ctx=await gapSession();if (ctx.response) return ctx.response
 const body=await request.json().catch(() => null),input=gapKnowledgeInput(body)
 if (!input) return NextResponse.json({ error:ctx.t(body && !body.action ? 'reviewRequired' : 'invalid') },{ status:body && !body.action ? 409 : 400,headers:gapHeaders })
 if (input.action==='confirm') {
  const result=await ctx.db.rpc('confirm_gap_knowledge_review',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_review_id:input.review_id })
  if (result.error) return gapError(result.error,ctx.t)
  return NextResponse.json(result.data,{ headers:gapHeaders })
 }
 if (input.destino==='regla' && !ctx.isAdmin) return NextResponse.json({ error:ctx.t('adminRequired') },{ status:403 })
 const result=await prepareGapKnowledgeReview(ctx,input)
 if (result.error) return gapError(result.error,ctx.t)
 return NextResponse.json({ review:result.data },{ headers:gapHeaders })
}
