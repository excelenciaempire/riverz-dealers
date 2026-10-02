import { NextResponse } from 'next/server';
import type { Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';
import { RuleReviewError } from './rule-reviews';
export const ruleReviewHeaders = { 'Cache-Control': 'private, no-store' };
export function ruleReviewFailure(locale: Locale, error: unknown) {
  const code = error instanceof RuleReviewError ? error.code : 'unavailable';
  return NextResponse.json({ error: translate(locale, `reglas.reviewError_${code}`) }, { status: { invalid: 400, notFound: 404, changed: 409, forbidden: 403, readOnly: 402, limited: 429, unavailable: 503 }[code], headers: ruleReviewHeaders });
}
export async function ruleReviewBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new RuleReviewError('invalid');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192)) throw new RuleReviewError('invalid');
  const reader = request.body?.getReader(); if (!reader) throw new RuleReviewError('invalid');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 8192) { await reader.cancel(); throw new RuleReviewError('invalid'); } chunks.push(chunk.value); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new RuleReviewError('invalid'); } finally { reader.releaseLock(); }
}
