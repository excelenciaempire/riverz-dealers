import { NextResponse } from 'next/server'
import { z } from 'zod'
import { inboxSession } from '@/lib/inbox/server-context'
import { csrfGuard } from '@/lib/csrf'
import { UUID } from '@/lib/inbox/collaboration'
import { parseToolContextPolicy } from '@/lib/ai/tool-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
export const dynamic='force-dynamic'
type Params={ params:Promise<{ id:string }> }
const headers={ 'Cache-Control':'private, no-store' },inputSchema=z.object({ id:z.string().uuid(),expected_revision:z.number().int().min(0).max(999999),policy:z.unknown() }).strict()
async function session(id:string) {
 const ctx=await inboxSession();if (ctx.response) return ctx
 const locale=await getLocale(),t=(key:string) => translate(locale,`operation.${key}`)
 if (!UUID.test(id)) return { response:NextResponse.json({ error:t('contextNotFound') },{ status:404,headers }) }
 const agent=await ctx.db.from('ai_agents').select('id').eq('workspace_id',ctx.workspaceId).eq('id',id).is('deleted_at',null).maybeSingle()
 if (agent.error) return { response:serverError(agent.error,t('contextFailed')) }
 if (!agent.data) return { response:NextResponse.json({ error:t('contextNotFound') },{ status:404,headers }) }
 return { ...ctx,t }
}
export async function GET(_request:Request,{ params }:Params) {
 const { id }=await params,ctx=await session(id);if (ctx.response) return ctx.response
 const policy=await ctx.db.from('ai_tool_context_policies').select('revision,policy,updated_at').eq('workspace_id',ctx.workspaceId).eq('agent_id',id).maybeSingle()
 if (policy.error) return serverError(policy.error,ctx.t('contextFailed'))
 const history=await ctx.db.from('ai_tool_context_policy_versions').select('id,revision,policy,actor_id,created_at').eq('workspace_id',ctx.workspaceId).eq('agent_id',id).order('revision',{ ascending:false }).limit(21)
 if (history.error) return serverError(history.error,ctx.t('contextFailed'))
 const fresh=await session(id);if (fresh.response) return fresh.response
 if (fresh.workspaceId!==ctx.workspaceId || fresh.userId!==ctx.userId) return NextResponse.json({ error:ctx.t('contextNotFound') },{ status:404,headers })
 return NextResponse.json({ revision:policy.data?.revision ?? 0,policy:policy.data?.policy ?? {},can_edit:fresh.isAdmin,history:(history.data ?? []).slice(0,20),truncated:(history.data ?? []).length>20 },{ headers })
}
export async function POST(request:Request,{ params }:Params) {
 const csrf=await csrfGuard(request);if (csrf) return csrf
 const { id }=await params,ctx=await session(id);if (ctx.response) return ctx.response
 if (!ctx.isAdmin) return NextResponse.json({ error:ctx.t('contextAdminRequired') },{ status:403,headers })
 const input=inputSchema.safeParse(await request.json().catch(() => null)),policy=input.success ? parseToolContextPolicy(input.data.policy) : null
 if (!input.success || !policy) return NextResponse.json({ error:ctx.t('contextInvalid') },{ status:400,headers })
 const result=await ctx.db.rpc('save_ai_tool_context_policy',{ p_id:input.data.id,p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_agent_id:id,p_expected_revision:input.data.expected_revision,p_policy:policy })
 if (result.error) {
  const message=String(result.error.message)
  if (message.includes('tool_context_changed')) return NextResponse.json({ error:ctx.t('contextChanged') },{ status:409,headers })
  if (message.includes('subscription_read_only')) return NextResponse.json({ error:ctx.t('contextReadOnly') },{ status:402,headers })
  if (message.includes('invalid_tool_context')) return NextResponse.json({ error:ctx.t('contextNotFound') },{ status:404,headers })
  return serverError(result.error,ctx.t('contextFailed'))
 }
 return NextResponse.json(result.data,{ headers })
}
