import { NextResponse } from 'next/server';
import { inboxSession } from '@/lib/inbox/server-context';
import { parseCaseReasonQuery } from '@/lib/dashboard/case-reason-contract';
import { loadCaseReasonReport } from '@/lib/dashboard/case-reason-report';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const locale = await getLocale(), headers = { 'Cache-Control': 'private, no-store' };
  const fail = (key: string, status: number) => NextResponse.json({ error: translate(locale,`dashboard.caseReasons_${key}`) }, { status,headers });
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('unavailable',404);
  const ctx = await inboxSession();
  if (ctx.response) { ctx.response.headers.set('Cache-Control',headers['Cache-Control']); return ctx.response; }
  let query;
  try { query = parseCaseReasonQuery(new URL(request.url).searchParams); }
  catch { return fail('invalid',400); }
  try { return NextResponse.json(await loadCaseReasonReport(ctx.db,ctx.workspaceId,ctx.userId,query), { headers }); }
  catch { return fail('failed',503); }
}
