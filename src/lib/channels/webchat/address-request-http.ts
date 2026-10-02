import { NextResponse } from 'next/server';
import type { Locale } from '@/lib/i18n/config';
import { widgetOrderText } from './order-contract';
import { AddressRequestError } from './address-requests';
export const addressRequestHeaders = { 'Cache-Control': 'private, no-store' };
export function addressRequestFailure(locale: Locale, error: unknown) {
  const code = error instanceof AddressRequestError ? error.code : 'unavailable';
  const status = { invalid: 400, notFound: 404, changed: 409, pending: 409, limited: 429, readOnly: 402, unavailable: 503 }[code];
  return NextResponse.json({ error: widgetOrderText(locale, `addressRequestError_${code}`) }, { status, headers: addressRequestHeaders });
}
export async function addressRequestBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AddressRequestError('invalid');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 8192)) throw new AddressRequestError('invalid');
  const reader = request.body?.getReader(); if (!reader) throw new AddressRequestError('invalid');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new AddressRequestError('invalid'); } chunks.push(chunk.value); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new AddressRequestError('invalid'); } finally { reader.releaseLock(); }
}
