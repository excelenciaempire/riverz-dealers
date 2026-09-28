import type { SupabaseClient } from '@supabase/supabase-js';

export type TopupOrigin = 'manual' | 'automatica' | 'desconocida';
export interface TopupHistoryRow {
  id: string;
  creadoEn: string;
  centavos: number;
  saldoDespuesCentavos: number;
  origen: TopupOrigin;
}
interface StoredTopup {
  id: string;
  creado_en: string;
  centavos: number;
  saldo_despues_centavos: number;
  stripe_id: string | null;
  detalle: Record<string, unknown> | null;
}
interface PaymentMetadata {
  workspace_id?: string;
  tipo?: string;
  origen?: string;
}

/** A webhook is a delivery mechanism, not evidence that a payment was automatic. */
export function topupOrigin(
  detail: Record<string, unknown> | null
): TopupOrigin {
  if (detail?.automatica === true || detail?.origen === 'automatica')
    return 'automatica';
  if (
    detail?.automatica === false ||
    detail?.origen === 'manual' ||
    typeof detail?.sesion === 'string'
  )
    return 'manual';
  return 'desconocida';
}

/** Read-only, all-time history. Only credited principal is a top-up: never fees,
 * refunds, bonuses, failed attempts or subscription payments. */
export async function listTopupHistory(
  db: SupabaseClient,
  workspaceId: string,
  page = 0,
  readPayment?: (id: string) => Promise<{ metadata: PaymentMetadata }>
) {
  const size = 20;
  const offset =
    Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)) * size;
  const { data, error } = await db
    .from('wallet_movimientos')
    .select(
      'id, creado_en, centavos, saldo_despues_centavos, stripe_id, detalle'
    )
    .eq('workspace_id', workspaceId)
    .eq('tipo', 'recarga')
    .gt('centavos', 0)
    .order('creado_en', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + size);
  if (error) throw new Error('wallet_topup_history_unavailable');
  const stored = (data ?? []) as StoredTopup[];
  const rows = stored.slice(0, size);
  const unknownIds = rows
    .filter(
      (row) => topupOrigin(row.detalle) === 'desconocida' && row.stripe_id
    )
    .map((row) => row.stripe_id!);
  const automatic = new Set<string>();
  if (unknownIds.length) {
    const attempts = await db
      .from('wallet_auto_intentos')
      .select('payment_intent_id')
      .eq('workspace_id', workspaceId)
      .in('payment_intent_id', unknownIds);
    // Missing supplementary evidence must not hide a credited payment.
    for (const attempt of attempts.data ?? [])
      automatic.add(attempt.payment_intent_id);
  }
  const filas: TopupHistoryRow[] = await Promise.all(
    rows.map(async (row) => {
      let origen = topupOrigin(row.detalle);
      if (row.stripe_id && automatic.has(row.stripe_id)) origen = 'automatica';
      // Older webhooks did not save origin. Consult only the existing receipt;
      // never create/retry a payment or infer manual from the absence of an attempt.
      if (
        origen === 'desconocida' &&
        row.stripe_id?.startsWith('pi_') &&
        readPayment
      ) {
        try {
          const { metadata } = await readPayment(row.stripe_id);
          if (
            metadata.workspace_id === workspaceId &&
            metadata.tipo === 'recarga_billetera'
          ) {
            origen =
              metadata.origen === 'automatica'
                ? 'automatica'
                : !metadata.origen || metadata.origen === 'manual'
                  ? 'manual'
                  : 'desconocida';
          }
        } catch {
          /* Keep the actual amount/timestamp; do not fabricate origin. */
        }
      }
      return {
        id: row.id,
        creadoEn: row.creado_en,
        centavos: Number(row.centavos),
        saldoDespuesCentavos: Number(row.saldo_despues_centavos),
        origen,
      };
    })
  );
  return { filas, hayMas: stored.length > size };
}
