import { NextResponse } from 'next/server';
import { z } from 'zod';
import { inboxConversation } from '@/lib/inbox/server-context';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { RuleReviewError, readRuleReview, writeRuleReview } from '@/lib/ai/rule-reviews';
import { ruleReviewBody, ruleReviewFailure, ruleReviewHeaders } from '@/lib/ai/rule-review-http';
type Route = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
function target(request: Request) {
  const query = [...new URL(request.url).searchParams];
  if (query.length !== 2 || new Set(query.map(([key]) => key)).size !== 2) throw new RuleReviewError('invalid');
  const parsed = z.object({ turn_id: z.string().uuid(), rule_id: z.string().uuid() }).strict().safeParse(Object.fromEntries(query));
  if (!parsed.success) throw new RuleReviewError('invalid'); return parsed.data;
}
export async function GET(request: Request, route: Route) {
  const locale = await getLocale(); if (!SHOW_RIVERZ_IMPROVEMENTS) return ruleReviewFailure(locale, new RuleReviewError('notFound'));
  const id = (await route.params).id, ctx = await inboxConversation(id);
  if (ctx.response) { ctx.response.headers.set('Cache-Control', ruleReviewHeaders['Cache-Control']); return ctx.response; }
  try {
    const query = target(request), view = await readRuleReview(ctx.db, ctx.workspaceId, ctx.userId, id, query.turn_id, query.rule_id);
    const fresh = await inboxConversation(id);
    if (fresh.response) { fresh.response.headers.set('Cache-Control', ruleReviewHeaders['Cache-Control']); return fresh.response; }
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) throw new RuleReviewError('notFound');
    return NextResponse.json(view, { headers: ruleReviewHeaders });
  }
  catch (error) { return ruleReviewFailure(locale, error); }
}
export async function POST(request: Request, route: Route) {
  const locale = await getLocale(); if (!SHOW_RIVERZ_IMPROVEMENTS) return ruleReviewFailure(locale, new RuleReviewError('notFound'));
  const block = await csrfGuard(request); if (block) { block.headers.set('Cache-Control', ruleReviewHeaders['Cache-Control']); return block; }
  const id = (await route.params).id, ctx = await inboxConversation(id);
  if (ctx.response) { ctx.response.headers.set('Cache-Control', ruleReviewHeaders['Cache-Control']); return ctx.response; }
  try { const query = target(request); return NextResponse.json(await writeRuleReview(ctx.db, ctx.workspaceId, ctx.userId, id, query.turn_id, query.rule_id, await ruleReviewBody(request)), { headers: ruleReviewHeaders }); }
  catch (error) { return ruleReviewFailure(locale, error); }
}
