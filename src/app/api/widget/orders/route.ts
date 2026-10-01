import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';
import { parseVisitorOrderQuery, widgetOrderText } from '@/lib/channels/webchat/order-contract';
import { loadVisitorOrders } from '@/lib/channels/webchat/visitor-orders';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'en' ? 'en' : 'es';
  const fail = (key: string, status: number) => NextResponse.json({ error: widgetOrderText(locale, key) }, { status, headers });
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('orderNotAvailable', 404);
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) {
    guard.response.headers.set('Cache-Control', headers['Cache-Control']);
    return guard.response;
  }
  let input;
  try {
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return fail('orderInvalid', 400);
    input = parseVisitorOrderQuery(Object.fromEntries(params));
  } catch { return fail('orderInvalid', 400); }
  try {
    return NextResponse.json(await loadVisitorOrders(supabaseAdmin(), guard.session, input.cursor), { headers });
  } catch { return fail('orderUnavailable', 503); }
}
