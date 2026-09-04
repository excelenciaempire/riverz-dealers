import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { ensureTikTokCommentWebhook } from '@/lib/channels/tiktok_comment/webhook-subscribe';
import { withCronRun } from '@/lib/cron/heartbeat';
import { healStalledWork } from '@/lib/health/self-heal';

/**
 * Recuperación conservadora tras una caída. Los sincronizadores de cada canal
 * ya son incrementales e idempotentes y el scheduler los relanza cuando se
 * atrasan; esta ruta arregla el estado que puede impedir que esas colas sigan.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (result) {
    if (result instanceof Response) return result;
    throw result;
  }

  const work = await healStalledWork(supabaseAdmin());
  // TikTok no expone una renovación fiable por webhook. Esta función es
  // idempotente y tiene su propio límite de frecuencia para no castigar la API.
  const tiktokWebhook = await ensureTikTokCommentWebhook();
  return NextResponse.json({ ok: true, work, tiktokWebhook });
}

export const GET = withCronRun('self-heal', cronHandler);
