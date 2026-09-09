import type { SupabaseClient } from '@supabase/supabase-js';
import { ESTADOS_VIVOS } from './connections';

/** Merge telemetry against the current row, never the pre-refresh snapshot.
 * Compare-and-swap prevents a concurrent token/webhook update being lost.
 * A merchant disconnecting while a poll runs must stay disconnected. */
export async function savePollState(
  db: SupabaseClient,
  id: string,
  configPatch: Record<string, unknown>,
  error: string | null = null,
  options: { complete?: boolean } = {},
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await db.from('channel_connections')
      .select('config,status').eq('id', id).maybeSingle();
    if (current.error) throw new Error(`poll state read: ${current.error.code}`);
    const row = current.data;
    if (!row || !ESTADOS_VIVOS.some(s => s === row.status)) return;
    let query = db.from('channel_connections').update({
      config: { ...(row.config ?? {}), ...configPatch },
      ...(error || options.complete !== false ? {
        status: error ? 'error' : 'connected',
        last_error: error,
      } : {}),
      ...(error || options.complete === false ? {} : { last_synced_at: new Date().toISOString() }),
    }).eq('id', id).in('status', [...ESTADOS_VIVOS]);
    query = row.config === null
      ? query.is('config', null)
      : query.eq('config', JSON.stringify(row.config));
    const saved = await query.select('id');
    if (saved.error) throw new Error(`poll state write: ${saved.error.code}`);
    if (saved.data?.length) return;
  }
  throw new Error('poll state changed concurrently; retry next run');
}
