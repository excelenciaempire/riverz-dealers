import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';

/** Compatibility endpoint for retired callers. Never calls Apify or bills usage. */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  return NextResponse.json({ ok: true, disabled: true, reason: 'feature_retired' });
}
