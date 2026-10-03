import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { readDealerSettings } from './settings-server';
import { checkDb } from './server';
import { DealerError } from './validation';
import { parseDealerFeed } from './feed';
import { fetchDealerFeed } from './feed-fetch';

export async function syncDealerInventory(
  db: SupabaseClient,
  workspace: string,
  upload?: { text: string; format: 'json' | 'csv' }
) {
  const { settings } = await readDealerSettings(db, workspace),
    config = settings.inventory;
  if (!upload && !config.feed_url) throw new DealerError('feed');
  const source = upload ? 'upload' : config.feed_url,
    id = randomUUID();
  checkDb(
    (
      await db
        .from('dealer_sync_runs')
        .update({
          status: 'error',
          error_code: 'expired',
          finished_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspace)
        .eq('status', 'running')
        .lt('started_at', new Date(Date.now() - 600000).toISOString())
    ).error
  );
  const claim = await db
    .from('dealer_sync_runs')
    .insert({ id, workspace_id: workspace, source, status: 'running' });
  if (claim.error?.code === '23505') throw new DealerError('sync_busy', 409);
  checkDb(claim.error);
  try {
    let text = upload?.text;
    if (text == null) {
      const creds = await db
        .from('dealer_credentials')
        .select('inventory_token_encrypted')
        .eq('workspace_id', workspace)
        .maybeSingle();
      checkDb(creds.error);
      text = await fetchDealerFeed(
        config.feed_url,
        creds.data?.inventory_token_encrypted
          ? decrypt(creds.data.inventory_token_encrypted)
          : null
      );
    }
    const rows = parseDealerFeed(text, config, upload?.format ?? config.format);
    // A preview count cannot prove completeness: retire is explicit and URL-feed only.
    const r = await db.rpc('dealer_import_inventory', {
      p_workspace: workspace,
      p_run: id,
      p_rows: rows,
      p_source: source,
      p_retire: !upload && config.retire_missing,
      p_status: config.allow_status_updates,
      p_minimum: config.minimum_units,
    });
    checkDb(r.error);
    return r.data;
  } catch (e) {
    await db
      .from('dealer_sync_runs')
      .update({
        status: 'error',
        error_code: e instanceof DealerError ? e.code : 'feed',
        finished_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('workspace_id', workspace);
    throw e instanceof DealerError ? e : new DealerError('feed', 502);
  }
}
