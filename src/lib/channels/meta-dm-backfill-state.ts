export const META_DM_BACKFILL_MARK = 'dm_backfill_marca';
export const META_DM_BACKFILL_PENDING = 'dm_backfill_pendiente';

export interface MetaDmBackfillPending {
  /** Sólo hilos más viejos que este borde quedan por mirar. */
  hasta: string;
  /** Marca que se adopta cuando la pasada termine por completo. */
  objetivo: string;
}

export function readMetaDmBackfillPending(
  value: unknown
): MetaDmBackfillPending | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.hasta !== 'string' ||
    typeof candidate.objetivo !== 'string'
  ) {
    return null;
  }
  if (!Number.isFinite(new Date(candidate.hasta).getTime())) return null;
  return { hasta: candidate.hasta, objetivo: candidate.objetivo };
}

/**
 * Punto reanudable de una pasada.
 *
 * El borde es inclusivo: si ese hilo fue el que falló, la siguiente corrida
 * tiene que volver a procesarlo. Los mensajes ya escritos son idempotentes.
 */
export function isInsideMetaDmResumeWindow(
  updatedAtMs: number,
  pending: MetaDmBackfillPending | null
): boolean {
  return !pending || updatedAtMs <= new Date(pending.hasta).getTime();
}

export function updateMetaDmBackfillCheckpoint(
  config: Record<string, unknown>,
  outcome: {
    complete: boolean;
    objective: string;
    /** Último hilo visitado o hilo exacto que debe reintentarse. */
    resumeAt: string | null;
  }
): Record<string, unknown> {
  const next = { ...config };
  // Cursor del antiguo barrido por contactos.
  delete next.dm_backfill_cursor;

  if (outcome.complete) {
    next[META_DM_BACKFILL_MARK] = outcome.objective;
    delete next[META_DM_BACKFILL_PENDING];
  } else if (outcome.resumeAt) {
    next[META_DM_BACKFILL_PENDING] = {
      hasta: outcome.resumeAt,
      objetivo: outcome.objective,
    } satisfies MetaDmBackfillPending;
  }
  return next;
}
