import { NextResponse } from 'next/server'
import { guidanceSession,guidanceError } from '@/lib/ai/guidance-server'
import { guidanceVersionInput } from '@/lib/ai/guidance-versions'
import { UUID } from '@/lib/inbox/collaboration'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
type Route={ params:Promise<{ id:string }> }
const headers={ 'Cache-Control':'private, no-store' }
export async function GET(request:Request,route:Route) {
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  const id=(await route.params).id
  if (!UUID.test(id)) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  const before=new URL(request.url).searchParams.get('before')
  if (before!==null && (!/^\d+$/.test(before) || Number(before)<1 || Number(before)>=2147483647)) return NextResponse.json({ error:ctx.t('invalid') },{ status:400 })
  const rule=await ctx.db.from('agent_guidance').select('*').eq('workspace_id',ctx.workspaceId).eq('id',id).maybeSingle()
  if (rule.error) return serverError(rule.error,ctx.t('saveFailed'))
  if (!rule.data) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  let query=ctx.db.from('guidance_live_versions').select('rule_id,revision,snapshot,actor_id,source,created_at').eq('workspace_id',ctx.workspaceId).eq('rule_id',id).order('revision',{ ascending:false }).limit(51)
  if (before) query=query.lt('revision',Number(before))
  const [draft,history]=await Promise.all([
    ctx.db.from('guidance_drafts').select('*').eq('workspace_id',ctx.workspaceId).eq('rule_id',id).maybeSingle(),query,
  ])
  if (draft.error || history.error) return serverError(draft.error || history.error,ctx.t('saveFailed'))
  const versions=(history.data ?? []).slice(0,50)
  return NextResponse.json({ rule:rule.data,draft:draft.data,versions,next_before:(history.data?.length ?? 0)>50 ? versions[versions.length-1]?.revision : null,is_admin:ctx.isAdmin,user_id:ctx.userId },{ headers })
}
export async function POST(request:Request,route:Route) {
  const csrf=await csrfGuard(request);if (csrf) return csrf
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  const id=(await route.params).id
  if (!UUID.test(id)) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  const input=guidanceVersionInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ error:ctx.t('invalid') },{ status:400 })
  if ((input.action==='publish' || input.action==='rollback') && !ctx.isAdmin) return NextResponse.json({ error:ctx.t('adminRequired') },{ status:403 })
  const args:Record<string,unknown>={ p_workspace_id:ctx.workspaceId,p_rule_id:id,p_actor_id:ctx.userId }
  if ('live_revision' in input) args.p_live_revision=input.live_revision
  if ('draft_revision' in input) args.p_draft_revision=input.draft_revision
  if (input.action==='save') args.p_snapshot=input.snapshot
  if (input.action==='rollback') args.p_target_revision=input.target_revision
  const names={ save:'save_guidance_draft',publish:'publish_guidance_draft',rollback:'rollback_guidance_version',discard:'discard_guidance_draft' }
  const result=await ctx.db.rpc(names[input.action],args)
  if (result.error) return guidanceError(result.error,ctx.t)
  return NextResponse.json({ result:result.data },{ headers })
}
