import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import { persistCallResult, type VoiceResultPayload } from '@/lib/voice/result';

/**
 * POST /api/internal/voice/result
 * The worker reports a finished call (once). Idempotent by call_id.
 * Auth: Bearer VOICE_WORKER_SECRET.
 */
export async function POST(request: Request) {
  try {
    assertVoiceWorkerAuth(request);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const body = (await request.json().catch(() => null)) as VoiceResultPayload | null;
  if (!body?.call_id || !body.status) {
    return NextResponse.json(
      { error: 'call_id and status required' },
      { status: 400 },
    );
  }

  try {
    const res = await persistCallResult(body);
    if (!res.ok) {
      return NextResponse.json({ error: res.reason ?? 'failed' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, 'voice result failed');
  }
}
