import { NextResponse } from 'next/server';
import { listConnections } from '@/lib/channels/connections';
import { assertCronAuthAny } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  isAdSyncFailure,
  syncAdPostsForConnection,
} from '@/lib/channels/meta-ads-sync';
import { withCronRun } from '@/lib/cron/heartbeat';
import type { ChannelConnection } from '@/types';
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  mapWithConcurrency,
} from '@/lib/async/concurrency';

/**
 * GET /api/meta/ads-sync
 *
 * Cron-triggered: walks every connected fb_comment / ig_comment
 * connection and refreshes the post_id → ad_id mapping so the inbox
 * can correctly flag which incoming comments came from ads.
 *
 * Auth: header `x-cron-secret`. Acepta ADS_SYNC_SECRET (el que manda el
 * workflow de GitHub) o AUTOMATION_CRON_SECRET (el que manda el reloj interno);
 * los dos son secretos del mismo dueño, así que aceptar cualquiera no debilita
 * nada y evita el 401 mudo que dejaría el trabajo sin correr para siempre.
 */
async function handler(req: Request): Promise<Response> {
  try {
    assertCronAuthAny(req, ['ADS_SYNC_SECRET', 'AUTOMATION_CRON_SECRET']);
  } catch (r) {
    return r as Response;
  }

  const db = supabaseAdmin();
  const connections = await listConnections(db, {
    channels: ['fb_comment', 'ig_comment'],
    statuses: ['connected'],
  });

  const results = await mapWithConcurrency(
    (connections ?? []) as ChannelConnection[],
    DEFAULT_CONNECTION_CONCURRENCY,
    async (
      c
    ): Promise<{
      id: string;
      inserted: number;
      updated: number;
      status?: string;
      errors?: string[];
      error?: string;
    }> => {
      try {
        const r = await syncAdPostsForConnection(db, c);
        return { id: c.id, ...r };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        return { id: c.id, inserted: 0, updated: 0, error: msg };
      }
    }
  );

  const failed = results.filter(isAdSyncFailure).length;
  const totalInserted = results.reduce((sum, row) => sum + row.inserted, 0);
  const totalUpdated = results.reduce((sum, row) => sum + row.updated, 0);

  return NextResponse.json(
    {
      ok: failed === 0,
      connections: results.length,
      inserted: totalInserted,
      updated: totalUpdated,
      failed,
      results,
    },
    { status: failed ? 207 : 200 }
  );
}

/** Registra la corrida en `cron_runs` como el resto de los trabajos: hasta
 *  ahora este no dejaba rastro y su silencio era indistinguible de no correr. */
export const GET = withCronRun('ads-sync', handler);
