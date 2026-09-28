import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from '@/lib/db/paginate';
import { assertMetadataOnly } from './pii';

export async function getPendingWalletReconciliation(db: SupabaseClient) {
  const columns = 'id,reserva_centavos,created_at';
  assertMetadataOnly('wallet_operaciones', columns);
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const rows = await selectAll<{ id: string; reserva_centavos: number; created_at: string }>(db, 'wallet_operaciones',
    q => q.eq('estado', 'reservada').neq('concepto', 'numero_telefono').lt('created_at', cutoff),
    { select: columns, strict: true });
  return { pending: rows.length, reservedCents: rows.reduce((n, row) => n + Number(row.reserva_centavos), 0) };
}
