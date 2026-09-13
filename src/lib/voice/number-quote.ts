import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AvailableNumber, PhoneNumberType } from './telnyx-numbers';

export interface NumberQuote {
  workspace: string; phone: string; country: string; type: PhoneNumberType;
  upfront: number; monthly: number; expires: number;
}
export function cents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,4})?$/.test(value)) throw new Error('number_price_unavailable');
  const amount = Number(value) * 100;
  if (!Number.isSafeInteger(Math.round(amount)) || Math.abs(amount - Math.round(amount)) > 0.00001) throw new Error('number_price_unavailable');
  return Math.round(amount);
}
function signature(payload: string) {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('number_quote_unconfigured');
  return createHmac('sha256', key).update('voice-number-v1:' + payload).digest();
}
export function quoteNumber(n: AvailableNumber, workspace: string, country: string, type: PhoneNumberType, now = Date.now()) {
  if (n.currency?.toUpperCase() !== 'USD') throw new Error('number_price_unavailable');
  const quote: NumberQuote = { workspace, country, type, phone: n.phone_number, upfront: cents(n.upfront_cost), monthly: cents(n.monthly_cost), expires: now + 10 * 60_000 };
  if (quote.monthly <= 0) throw new Error('number_price_unavailable');
  const payload = Buffer.from(JSON.stringify(quote)).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}
export function verifyNumberQuote(token: string, workspace: string, phone: string, now = Date.now()): NumberQuote {
  try {
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra) throw new Error();
    const received = Buffer.from(sig, 'base64url'), expected = signature(payload);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
    const q = JSON.parse(Buffer.from(payload, 'base64url').toString()) as NumberQuote;
    if (q.workspace !== workspace || q.phone !== phone || q.expires <= now || !Number.isSafeInteger(q.upfront) || !Number.isSafeInteger(q.monthly) || q.upfront < 0 || q.monthly <= 0) throw new Error();
    return q;
  } catch { throw new Error('number_quote_invalid'); }
}
/** Telnyx MRC is calendar-month billing, not the purchase anniversary. */
export function nextNumberRenewal(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
