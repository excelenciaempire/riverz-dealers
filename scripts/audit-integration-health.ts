/** Read-only snapshot. Never prints credentials or customer message bodies.
 * Run: node --env-file=.env.local --import tsx scripts/audit-integration-health.ts */
import { createClient } from '@supabase/supabase-js';
import { SCHEDULED_JOBS } from '../src/lib/cron/schedule';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  async function all(table: string, columns: string) {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await db.from(table).select(columns).order('id').range(offset, offset + 999);
      if (result.error) throw new Error(`${table}: ${result.error.code}`);
      rows.push(...result.data as unknown as Record<string, unknown>[]);
      if (result.data.length < 1000) return rows;
    }
  }
  const channels = await all('channel_connections', 'id,channel,status,last_error,last_synced_at');
  const stores = await all('shopify_connections', 'id,platform,status,last_error');
  const jobs = [];
  // One indexed query per job avoids truncating infrequent jobs behind frequent ones.
  for (const job of SCHEDULED_JOBS) {
    const result = await db.from('cron_runs').select('status,started_at,finished_at,error')
      .eq('name', job.name).in('status', ['ok', 'error'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw new Error(`cron_runs: ${result.error.code}`);
    jobs.push({ name: job.name, schedule: job.schedule, latest: result.data });
  }
  const active = channels.filter(row => ['connected', 'error', 'expired'].includes(String(row.status)));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(),
    channels: active, stores, jobs,
    limitation: 'Stored health and completed runs; not an end-to-end send/payment test. Jobs without configured accounts can return ok.',
  }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
