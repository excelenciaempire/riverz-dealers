import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  enrichExternalProfile,
  externalEnrichFailureReason,
} from '@/lib/instagram-agent/external-enrich';
import { withCronRun } from '@/lib/cron/heartbeat';

/**
 * GET /api/cron/instagram-external-enrich
 *
 * Drains external Instagram enrichment in small, rate-respecting batches:
 * for IG contacts that have a username, aren't opted out, and haven't been
 * externally enriched (or are stale), it scrapes their PUBLIC profile via the
 * third-party (Apify) and derives a non-sensitive interest persona.
 *
 * Kept OFF the webhook hot path (scraping is slow + rate-limited) and isolated
 * from the brand's Meta credentials. No APIFY_TOKEN → no-op. Auth:
 * x-cron-secret == AUTOMATION_CRON_SECRET.
 */

const BATCH = 5;
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // re-enrich at most every 60 days

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('contacts')
    .select('id, name, workspace_id, contact_ig_profile(external_enriched_at)')
    .in('channel', ['instagram', 'ig_comment'])
    .eq('opted_out', false)
    .not('name', 'is', null)
    .limit(300);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cutoff = Date.now() - STALE_MS;
  type Row = {
    id: string;
    name: string | null;
    workspace_id: string | null;
    contact_ig_profile:
      | { external_enriched_at: string | null }
      | { external_enriched_at: string | null }[]
      | null;
  };
  const due = ((data ?? []) as Row[])
    .filter((r) => (r.name ?? '').startsWith('@'))
    .filter((r) => {
      const prof = Array.isArray(r.contact_ig_profile)
        ? r.contact_ig_profile[0]
        : r.contact_ig_profile;
      const at = prof?.external_enriched_at;
      return !at || new Date(at).getTime() < cutoff;
    })
    .slice(0, BATCH);

  const counts: Record<string, number> = {
    enriched: 0,
    private: 0,
    skipped: 0,
    failed: 0,
  };
  const failureReasons: Record<string, number> = {};
  for (const r of due) {
    // El token sale de la integración del workspace (Integraciones → Apify);
    // sin token conectado, enrichExternalProfile devuelve 'skipped'.
    const result = await enrichExternalProfile(db, {
      contactId: r.id,
      username: r.name ?? '',
      workspaceId: r.workspace_id,
    });
    const failureReason = externalEnrichFailureReason(result);
    if (failureReason) {
      counts.failed++;
      failureReasons[failureReason] = (failureReasons[failureReason] ?? 0) + 1;
    } else {
      counts[result] = (counts[result] ?? 0) + 1;
    }
  }

  return NextResponse.json(
    {
      ok: counts.failed === 0,
      processed: due.length,
      ...counts,
      ...(counts.failed ? { failureReasons } : {}),
    },
    { status: counts.failed ? 207 : 200 }
  );
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun('instagram-external-enrich', cronHandler);
