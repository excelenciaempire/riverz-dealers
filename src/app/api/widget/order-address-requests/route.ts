import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/channels/webchat/guard';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { addressRequestInput } from '@/lib/channels/webchat/address-request-contract';
import { AddressRequestError, readAddressRequestReceipt, reserveAddressRequest, submitAddressRequest } from '@/lib/channels/webchat/address-requests';
import { addressRequestBody, addressRequestFailure, addressRequestHeaders } from '@/lib/channels/webchat/address-request-http';
import { POST as sendMessage } from '../messages/route';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, locale = params.get('locale') === 'en' ? 'en' : 'es';
  if (!SHOW_RIVERZ_IMPROVEMENTS) return addressRequestFailure(locale, new AddressRequestError('notFound'));
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) { guard.response.headers.set('Cache-Control', addressRequestHeaders['Cache-Control']); return guard.response; }
  try {
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new AddressRequestError('invalid');
    const value = z.object({ id: z.string().uuid(), locale: z.enum(['es', 'en']) }).strict().safeParse(Object.fromEntries(params));
    if (!value.success) throw new AddressRequestError('invalid');
    return NextResponse.json(await readAddressRequestReceipt(supabaseAdmin(), guard.session, guard.ctx.connection.id, value.data.id), { headers: addressRequestHeaders });
  } catch (error) { return addressRequestFailure(locale, error); }
}
export async function POST(request: Request) {
  let locale: 'es' | 'en' = 'es';
  if (!SHOW_RIVERZ_IMPROVEMENTS) return addressRequestFailure(locale, new AddressRequestError('notFound'));
  const guard = await requireSession(request, 'send');
  if (!guard.ok) { guard.response.headers.set('Cache-Control', addressRequestHeaders['Cache-Control']); return guard.response; }
  try {
    if ([...new URL(request.url).searchParams].length) throw new AddressRequestError('invalid');
    const raw = await addressRequestBody(request);
    if (raw && typeof raw === 'object' && 'locale' in raw && raw.locale === 'en') locale = 'en';
    const parsed = addressRequestInput.safeParse(raw); if (!parsed.success) throw new AddressRequestError('invalid');
    const db = supabaseAdmin(), reserved = await reserveAddressRequest(db, guard.session, guard.ctx.connection.id, parsed.data);
    if (reserved.receipt.status !== 'not_submitted') return NextResponse.json(reserved.receipt, { headers: addressRequestHeaders });
    // The existing route owns ingress, deduplication, automation and attribution.
    // Preserve original signed token/origin. Both send guards apply their limits.
    const messageHeaders = new Headers(request.headers);
    messageHeaders.set('Content-Type', 'application/json'); messageHeaders.delete('Content-Length');
    const response = await sendMessage(new Request(new URL('/api/widget/messages', request.url), { method: 'POST', headers: messageHeaders,
      body: JSON.stringify({ text: reserved.text, clientMessageId: parsed.data.id }) }));
    if (!response.ok) {
      if (response.status === 401) { response.headers.set('Cache-Control', addressRequestHeaders['Cache-Control']); return response; }
      const failure = addressRequestFailure(locale, new AddressRequestError(response.status === 429 ? 'limited' : 'unavailable'));
      const retry = response.headers.get('Retry-After'); if (retry && /^\d{1,6}$/.test(retry)) failure.headers.set('Retry-After', retry);
      return failure;
    }
    const ack = await response.json(); if (ack.ok !== true) throw new AddressRequestError('unavailable');
    return NextResponse.json(await submitAddressRequest(db, guard.session, guard.ctx.connection.id, parsed.data.id), { headers: addressRequestHeaders });
  } catch (error) { return addressRequestFailure(locale, error); }
}
