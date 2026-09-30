import { NextResponse } from 'next/server'
import { guidanceSession } from '@/lib/ai/guidance-server'
import { UUID } from '@/lib/inbox/collaboration'
import { serverError } from '@/lib/api/errors'
export async function GET(_request:Request,route:{ params:Promise<{ id:string }> }) {
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  const id=(await route.params).id
  if (!UUID.test(id)) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  const result=await ctx.db.rpc('ai_rule_context_metrics',{ p_workspace_id:ctx.workspaceId,p_rule_id:id,p_actor_id:ctx.userId })
  if (result.error) return result.error.message.includes('invalid_ai_evidence') ? NextResponse.json({ error:ctx.t('notFound') },{ status:404 }) : serverError(result.error,ctx.t('activityFailed'))
  const fresh=await guidanceSession();if (fresh.response) return fresh.response
  if (fresh.workspaceId!==ctx.workspaceId || fresh.userId!==ctx.userId) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  return NextResponse.json(result.data,{ headers:{ 'Cache-Control':'private, no-store' } })
}
