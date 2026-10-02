import { NextResponse } from 'next/server';
import { inboxSession } from '@/lib/inbox/server-context';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { parseFlowMetricQuery } from '@/lib/flows/metric-contract';
import { readFlowMetricEvidence } from '@/lib/flows/metric-evidence';
export const dynamic = 'force-dynamic';
/** The existing node map receives full authorized counts; failures never become zero. */
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  const locale = await getLocale(), headers = { 'Cache-Control': 'private, no-store' };
  const ctx = await inboxSession(); if (ctx.response) { ctx.response.headers.set('Cache-Control', headers['Cache-Control']); return ctx.response; }
  try {
    const query = parseFlowMetricQuery(new URL(request.url).searchParams), id = (await route.params).id;
    const view = await readFlowMetricEvidence(ctx.db, ctx.workspaceId, ctx.userId, id, query), fresh = await inboxSession();
    if (fresh.response) { fresh.response.headers.set('Cache-Control', headers['Cache-Control']); return fresh.response; }
    if (fresh.workspaceId !== ctx.workspaceId || fresh.userId !== ctx.userId) throw new Error('flow_metrics_not_found');
    return NextResponse.json(view, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: translate(locale, `flows.${code === 'invalid_flow_metrics' ? 'metricInvalid' : code === 'flow_metrics_not_found' ? 'metricNotFound' : 'metricUnavailable'}`) }, { status: code === 'invalid_flow_metrics' ? 400 : code === 'flow_metrics_not_found' ? 404 : 503, headers });
  }
}
