import { NextResponse } from 'next/server'
import { z } from 'zod'
import { inboxSession } from '@/lib/inbox/server-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { escapeLike } from '@/lib/security/like'
import { redactModelSecrets } from '@/lib/security/model-secrets'

const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(request: Request) {
  const locale = await getLocale()
  const fail = (status: number) => NextResponse.json({ error: translate(locale, 'templates.aiContextUnavailable') }, { status, headers })
  try {
    const ctx = await inboxSession()
    if (ctx.response) return ctx.response
    const input = z.string().trim().max(100).safeParse(new URL(request.url).searchParams.get('q') ?? '')
    if (!input.success) return fail(400)
    let query = ctx.db.from('shopify_products').select('id,title').eq('workspace_id', ctx.workspaceId)
    if (input.data) query = query.ilike('title', `%${escapeLike(input.data)}%`)
    const [products, agents] = await Promise.all([
      query.order('title').order('id').limit(51),
      ctx.db.from('ai_agents').select('id,name').eq('workspace_id', ctx.workspaceId).eq('is_active', true).order('id').limit(101),
    ])
    if (products.error || agents.error || (agents.data?.length ?? 0) > 100) return fail(503)
    const fresh = await inboxSession()
    if (fresh.response) return fresh.response
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) return fail(409)
    return NextResponse.json({
      products: (products.data ?? []).slice(0, 50).map(row => ({ id: row.id, label: redactModelSecrets(String(row.title)) })),
      agents: (agents.data ?? []).map(row => ({ id: row.id, label: redactModelSecrets(String(row.name)) })),
      has_more: (products.data?.length ?? 0) > 50,
    }, { headers })
  } catch { return fail(503) }
}
