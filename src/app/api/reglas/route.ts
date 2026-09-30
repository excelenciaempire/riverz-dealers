import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { guidanceSession,guidanceError } from '@/lib/ai/guidance-server'
import { guidanceCreateInput,guidanceSnapshot } from '@/lib/ai/guidance-versions'
import { UUID } from '@/lib/inbox/collaboration'
import { assertWorkspaceWritable,BillingReadOnlyError } from '@/lib/billing/read-only'
import { serverError } from '@/lib/api/errors'
const columns='id,agent_id,titulo,cuando,hacer,activa,orden,origen,clave,live_revision'
const headers={ 'Cache-Control':'private, no-store' }
export async function GET() {
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  const result=await ctx.db.from('agent_guidance').select(columns).eq('workspace_id',ctx.workspaceId).order('orden',{ ascending:true }).order('created_at',{ ascending:true })
  if (result.error) return serverError(result.error,ctx.t('saveFailed'))
  return NextResponse.json({ reglas:result.data ?? [],is_admin:ctx.isAdmin },{ headers })
}
export async function POST(request:Request) {
  const csrf=await csrfGuard(request);if (csrf) return csrf
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  const input=guidanceCreateInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ error:ctx.t('invalid') },{ status:400 })
  if (!input.draft && !ctx.isAdmin) return NextResponse.json({ error:ctx.t('adminRequired') },{ status:403 })
  const result=await ctx.db.rpc('create_guidance_rule',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_id:crypto.randomUUID(),p_agent_id:input.agent_id,p_snapshot:input.snapshot,p_draft:input.draft })
  if (result.error) return guidanceError(result.error,ctx.t)
  return NextResponse.json({ regla:result.data },{ status:201,headers })
}
export async function PATCH(request:Request) {
  const csrf=await csrfGuard(request);if (csrf) return csrf
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  if (!ctx.isAdmin) return NextResponse.json({ error:ctx.t('adminRequired') },{ status:403 })
  const id=new URL(request.url).searchParams.get('id')
  if (!id || !UUID.test(id)) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  const body=await request.json().catch(() => null) as Record<string,unknown> | null
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key => !['titulo','cuando','hacer','activa','live_revision'].includes(key)) || !['titulo','cuando','hacer','activa'].some(key => key in body) || body.activa!==undefined && typeof body.activa!=='boolean' || body.live_revision!==undefined && (typeof body.live_revision!=='number' || !Number.isInteger(body.live_revision) || body.live_revision<1 || body.live_revision>=2147483647)) return NextResponse.json({ error:ctx.t('invalid') },{ status:400 })
  const current=await ctx.db.from('agent_guidance').select('*').eq('workspace_id',ctx.workspaceId).eq('id',id).maybeSingle()
  if (current.error) return serverError(current.error,ctx.t('saveFailed'))
  if (!current.data) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  if (body.live_revision!==undefined && body.live_revision!==current.data.live_revision) return NextResponse.json({ error:ctx.t('changed') },{ status:409 })
  const snapshot=guidanceSnapshot({ titulo:'titulo' in body ? body.titulo : current.data.titulo,cuando:'cuando' in body ? body.cuando : current.data.cuando,hacer:'hacer' in body ? body.hacer : current.data.hacer })
  if (!snapshot) return NextResponse.json({ error:ctx.t('invalid') },{ status:400 })
  if (body.activa===true && current.data.activa===false && Object.keys(body).every(key => ['activa','live_revision'].includes(key))) {
    const draft=await ctx.db.from('guidance_drafts').select('*').eq('workspace_id',ctx.workspaceId).eq('rule_id',id).maybeSingle()
    if (draft.error) return serverError(draft.error,ctx.t('saveFailed'))
    if (draft.data?.base_revision===current.data.live_revision && JSON.stringify(guidanceSnapshot(draft.data.snapshot))===JSON.stringify(snapshot)) {
      const published=await ctx.db.rpc('publish_guidance_draft',{ p_workspace_id:ctx.workspaceId,p_rule_id:id,p_actor_id:ctx.userId,p_live_revision:current.data.live_revision,p_draft_revision:draft.data.draft_revision })
      if (published.error) return guidanceError(published.error,ctx.t)
      return NextResponse.json({ regla:published.data },{ headers })
    }
  }
  try { await assertWorkspaceWritable(ctx.db,ctx.workspaceId) } catch(e) { return e instanceof BillingReadOnlyError ? NextResponse.json({ error:ctx.t('readOnly') },{ status:402 }) : serverError(e,ctx.t('saveFailed')) }
  const result=await ctx.client.from('agent_guidance').update({ ...snapshot,...(body.activa!==undefined ? { activa:body.activa } : {}) }).eq('workspace_id',ctx.workspaceId).eq('id',id).eq('live_revision',current.data.live_revision).select(columns).maybeSingle()
  if (result.error) return guidanceError(result.error,ctx.t)
  if (!result.data) return NextResponse.json({ error:ctx.t('changed') },{ status:409 })
  return NextResponse.json({ regla:result.data },{ headers })
}
export async function DELETE(request:Request) {
  const csrf=await csrfGuard(request);if (csrf) return csrf
  const ctx=await guidanceSession();if (ctx.response) return ctx.response
  if (!ctx.isAdmin) return NextResponse.json({ error:ctx.t('adminRequired') },{ status:403 })
  const id=new URL(request.url).searchParams.get('id')
  if (!id || !UUID.test(id)) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  try { await assertWorkspaceWritable(ctx.db,ctx.workspaceId) } catch(e) { return e instanceof BillingReadOnlyError ? NextResponse.json({ error:ctx.t('readOnly') },{ status:402 }) : serverError(e,ctx.t('saveFailed')) }
  const result=await ctx.client.from('agent_guidance').delete().eq('workspace_id',ctx.workspaceId).eq('id',id).select('id').maybeSingle()
  if (result.error) return guidanceError(result.error,ctx.t)
  if (!result.data) return NextResponse.json({ error:ctx.t('notFound') },{ status:404 })
  return NextResponse.json({ ok:true },{ headers })
}
