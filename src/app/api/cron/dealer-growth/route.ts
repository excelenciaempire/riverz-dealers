import { NextResponse } from 'next/server';
import { assertCronAuthAny } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { syncDealerInventory } from '@/lib/dealers/inventory-sync';
import { dealerSettings } from '@/lib/dealers/settings';
export async function GET(req: Request) {
  try {
    assertCronAuthAny(req, ['CRON_SECRET', 'AUTOMATION_CRON_SECRET']);
  } catch (r) {
    return r as Response;
  }
  return withCronRun('dealer-growth', async () => {
    const db = supabaseAdmin(),
      { data, error } = await db
        .from('dealer_settings')
        .select('workspace_id,settings')
        .eq('settings->inventory->>enabled', 'true')
        .limit(1000);
    if (error) throw new Error('dealer_settings_unavailable');
    let synced = 0,
      failed = 0,
      attempted = 0;
    for (const row of data ?? []) {
      const settings = dealerSettings(row.settings);
      const last = await db
        .from('dealer_sync_runs')
        .select('started_at')
        .eq('workspace_id', row.workspace_id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last.error) throw new Error('dealer_sync_state_unavailable');
      if (
        last.data &&
        Date.now() - Date.parse(last.data.started_at) <
          settings.inventory.interval_minutes * 60000
      )
        continue;
      if (attempted++ >= 3) break;
      try {
        await syncDealerInventory(db, row.workspace_id);
        synced++;
      } catch {
        failed++;
      }
    }
    return NextResponse.json(
      { synced, failed },
      { status: failed ? 207 : 200 }
    );
  })(req);
}
