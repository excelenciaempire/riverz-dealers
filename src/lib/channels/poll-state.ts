import type { SupabaseClient } from '@supabase/supabase-js';
import { ESTADOS_VIVOS } from './connections';

/** Merge telemetry against the current row, never the pre-refresh snapshot.
 * Compare-and-swap prevents a concurrent token/webhook update being lost.
 * A merchant disconnecting while a poll runs must stay disconnected.
 *
 * El parche puede ser una función del config ACTUAL: un contador (las tandas
 * del historial que llegan en paralelo) se suma sobre lo que hay en la fila en
 * cada intento, no sobre una foto vieja que pisaría la suma de otra entrega. */
export async function savePollState(
  db: SupabaseClient,
  id: string,
  configPatch:
    | Record<string, unknown>
    | ((current: Record<string, unknown>) => Record<string, unknown>),
  error: string | null = null,
  options: { complete?: boolean; clearErrorPrefix?: string } = {},
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await db.from('channel_connections')
      .select('config,status,last_error').eq('id', id).maybeSingle();
    if (current.error) throw new Error(`poll state read: ${current.error.code}`);
    const row = current.data;
    if (!row || !ESTADOS_VIVOS.some(s => s === row.status)) return;
    const clearMatchingError = options.clearErrorPrefix != null
      && row.last_error?.startsWith(options.clearErrorPrefix) === true;
    const base = (row.config ?? {}) as Record<string, unknown>;
    const patch = typeof configPatch === 'function' ? configPatch(base) : configPatch;
    let query = db.from('channel_connections').update({
      config: { ...base, ...patch },
      ...(error || options.complete !== false || clearMatchingError ? {
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
