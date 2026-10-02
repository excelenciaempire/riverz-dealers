import { NextResponse } from 'next/server';
import { guidanceSession } from '@/lib/ai/guidance-server';
import { getLocale } from '@/lib/i18n/server';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { RuleReviewError, readRuleReviewMetrics } from '@/lib/ai/rule-reviews';
import { ruleReviewFailure, ruleReviewHeaders } from '@/lib/ai/rule-review-http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  const locale = await getLocale(); if (!SHOW_RIVERZ_IMPROVEMENTS) return ruleReviewFailure(locale, new RuleReviewError('notFound'));
  const ctx = await guidanceSession(); if (ctx.response) { ctx.response.headers.set('Cache-Control', ruleReviewHeaders['Cache-Control']); return ctx.response; }
  try {
    if ([...new URL(request.url).searchParams].length) throw new RuleReviewError('invalid');
    const id = (await route.params).id;
    const metrics = await readRuleReviewMetrics(ctx.db, ctx.workspaceId, ctx.userId, id), fresh = await guidanceSession();
    if (fresh.response) { fresh.response.headers.set('Cache-Control', ruleReviewHeaders['Cache-Control']); return fresh.response; }
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) throw new RuleReviewError('notFound');
    return NextResponse.json(metrics, { headers: ruleReviewHeaders });
  } catch (error) { return ruleReviewFailure(locale, error); }
}
