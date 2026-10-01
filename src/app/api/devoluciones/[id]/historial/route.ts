import { NextResponse } from 'next/server';
import { inboxSession } from '@/lib/inbox/server-context';
import { loadReturnHistory, parseReturnHistoryQuery, ReturnHistoryError } from '@/lib/returns/history';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const headers = { 'Cache-Control': 'private, no-store' };
  const fail = (key: string, status: number) => NextResponse.json({ error: translate(locale, `returns.${key}`) }, { status, headers });
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('notFound', 404);
  const ctx = await inboxSession();
  if (ctx.response) { ctx.response.headers.set('Cache-Control', headers['Cache-Control']); return ctx.response; }
  try {
    const { id } = await context.params;
    const query = parseReturnHistoryQuery(new URL(request.url).searchParams);
    return NextResponse.json(await loadReturnHistory(ctx.db, ctx.workspaceId, id, query.cursor), { headers });
  } catch (error) {
    const code = error instanceof ReturnHistoryError ? error.code : 'unavailable';
    return fail(code === 'invalid' ? 'invalidHistory' : code === 'notFound' ? 'notFound' : 'historyFailed', code === 'invalid' ? 400 : code === 'notFound' ? 404 : 503);
  }
}
