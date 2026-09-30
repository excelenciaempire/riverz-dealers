import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { gapSession,gapError,gapHeaders } from '@/lib/ai/gap-knowledge-server'
export const dynamic='force-dynamic'
type Row={ id:string;question:string;question_key:string;missing:string|null;conversation_id:string|null;created_at:string }
export async function GET(request:Request) {
 const ctx=await gapSession();if (ctx.response) return ctx.response
 const result=await ctx.db.rpc('list_visible_answer_gaps',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_resolved:new URL(request.url).searchParams.get('todos')==='1' })
 if (result.error) return gapError(result.error,ctx.t)
 const rows=(result.data ?? []) as Row[],groups=new Map<string,{ key:string;question:string;veces:number;ultima:string;missing:string|null;conversation_id:string|null }>()
 for (const f of rows.slice(0,500)) {
  const g=groups.get(f.question_key)
  if (g) { g.veces++;if (!g.missing && f.missing) g.missing=f.missing }
  else groups.set(f.question_key,{ key:f.question_key,question:f.question,veces:1,ultima:f.created_at,missing:f.missing,conversation_id:f.conversation_id })
 }
 const history=await ctx.client.from('gap_knowledge_reviews').select('id,question,answer,destination,target_id,target_title,actor_id,published_at,source_ids').eq('workspace_id',ctx.workspaceId).eq('state','published').order('published_at',{ ascending:false }).limit(20)
 if (history.error) return gapError(history.error,ctx.t)
 const fresh=await gapSession();if (fresh.response) return fresh.response
 if (fresh.workspaceId!==ctx.workspaceId || fresh.userId!==ctx.userId) return NextResponse.json({ error:ctx.t('changed') },{ status:409,headers:gapHeaders })
 return NextResponse.json({ gaps:[...groups.values()].sort((a,b) => b.veces-a.veces || Date.parse(b.ultima)-Date.parse(a.ultima)),truncated:rows.length>500,is_admin:ctx.isAdmin,history:history.data ?? [] },{ headers:gapHeaders })
}
export async function PATCH(request:Request) {
 const csrf=await csrfGuard(request);if (csrf) return csrf
 const ctx=await gapSession();if (ctx.response) return ctx.response
 const body=await request.json().catch(() => null)
 if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k => k!=='key') || typeof body.key!=='string' || !body.key.trim() || body.key.length>200) return NextResponse.json({ error:ctx.t('invalid') },{ status:400 })
 const result=await ctx.db.rpc('resolve_visible_answer_gaps',{ p_workspace_id:ctx.workspaceId,p_actor_id:ctx.userId,p_key:body.key })
 if (result.error) return gapError(result.error,ctx.t)
 return NextResponse.json({ ok:true,resolved_count:result.data },{ headers:gapHeaders })
}
