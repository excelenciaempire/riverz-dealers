import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * Record a cron invocation in `cron_runs` (migration 059) — the liveness
 * signal behind `/api/health/crons` ("did flows-resume actually fire in
 * the last 5 minutes?"). Call it once, right after the auth check, in
 * each cron route.
 *
 * Fire-and-forget and best-effort: it swallows every error internally and
 * returns void-resolving, so a logging hiccup (or the table missing) can
 * never break — or even slow — the cron. Invoke as `void pingCron('name')`.
 */
export async function pingCron(name: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    await supabaseAdmin()
      .from("cron_runs")
      .insert({ name, status: "ok", started_at: now, finished_at: now });
  } catch {
    /* best-effort heartbeat */
  }
}
