import { NextResponse } from 'next/server';
import { inboxConversation } from '@/lib/inbox/server-context';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { AddressRequestError, readCaseAddressRequests, prepareCaseAddressRequest } from '@/lib/channels/webchat/address-requests';
import { addressRequestBody, addressRequestFailure, addressRequestHeaders } from '@/lib/channels/webchat/address-request-http';
type Route = { params: Promise<{ id: string; operationId: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, route: Route) {
  const locale = await getLocale();
  if (!SHOW_RIVERZ_IMPROVEMENTS) return addressRequestFailure(locale, new AddressRequestError('notFound'));
  const params = await route.params, ctx = await inboxConversation(params.id);
  if (ctx.response) { ctx.response.headers.set('Cache-Control', addressRequestHeaders['Cache-Control']); return ctx.response; }
  try {
    if ([...new URL(request.url).searchParams].length) throw new AddressRequestError('invalid');
    return NextResponse.json(await readCaseAddressRequests(ctx.db, ctx.workspaceId, ctx.userId, params.id, params.operationId), { headers: addressRequestHeaders });
  } catch (error) { return addressRequestFailure(locale, error); }
}
export async function POST(request: Request, route: Route) {
  const locale = await getLocale();
  if (!SHOW_RIVERZ_IMPROVEMENTS) return addressRequestFailure(locale, new AddressRequestError('notFound'));
  const block = await csrfGuard(request); if (block) { block.headers.set('Cache-Control', addressRequestHeaders['Cache-Control']); return block; }
  const params = await route.params, ctx = await inboxConversation(params.id);
  if (ctx.response) { ctx.response.headers.set('Cache-Control', addressRequestHeaders['Cache-Control']); return ctx.response; }
  try {
    if ([...new URL(request.url).searchParams].length) throw new AddressRequestError('invalid');
    return NextResponse.json(await prepareCaseAddressRequest(ctx.db, ctx.workspaceId, ctx.userId, params.id, params.operationId, await addressRequestBody(request)), { headers: addressRequestHeaders });
  } catch (error) { return addressRequestFailure(locale, error); }
}
