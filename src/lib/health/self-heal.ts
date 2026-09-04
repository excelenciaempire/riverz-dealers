import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Una ejecución no debería permanecer trabajando tanto tiempo: los cron la
 * reclaman, ejecutan un paso y liberan la fila. Esperamos media hora antes de
 * tocarla para no competir con una llamada lenta del proveedor.
 */
export const RUNNING_GRACE_MS = 30 * 60_000;
/** Una automatización con espera legítima conserva una fila pending. */
export const PARTIAL_SETTLE_GRACE_MS = 2 * 60 * 60_000;

export function isStalledRunning(
  runAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!runAt) return false;
  const at = Date.parse(runAt);
  return Number.isFinite(at) && at <= now - RUNNING_GRACE_MS;
}

type HealResult = {
  automationPendingReset: number;
  flowPendingReset: number;
  automationLogsSettled: number;
};

/**
 * Recupera únicamente estado interno que quedó tomado por un proceso muerto.
 * No reenvía mensajes, no recrea webhooks ni ejecuta campañas: al devolver la
 * fila a `pending`, el cron dueño vuelve a reclamarla con su protección normal
 * contra carreras. Así una caída se repara sin inventar entregas duplicadas.
 */
export async function healStalledWork(
  db: SupabaseClient,
  now = new Date(),
): Promise<HealResult> {
  const nowIso = now.toISOString();
  const stalledBefore = new Date(now.getTime() - RUNNING_GRACE_MS).toISOString();
  const partialBefore = new Date(now.getTime() - PARTIAL_SETTLE_GRACE_MS).toISOString();

  const [automationRows, flowRows, partialLogs] = await Promise.all([
    db
      .from('automation_pending_executions')
      .select('id')
      .eq('status', 'running')
      .lte('run_at', stalledBefore)
      .limit(100),
    db
      .from('flow_pending_executions')
      .select('id')
      .eq('status', 'running')
      .lte('run_at', stalledBefore)
      .limit(100),
    db
      .from('automation_logs')
      .select('id')
      .eq('status', 'partial')
      .lte('created_at', partialBefore)
      .limit(100),
  ]);

  if (automationRows.error) throw new Error(automationRows.error.message);
  if (flowRows.error) throw new Error(flowRows.error.message);
  if (partialLogs.error) throw new Error(partialLogs.error.message);

  const automationIds = (automationRows.data ?? []).map((row) => String(row.id));
  const flowIds = (flowRows.data ?? []).map((row) => String(row.id));
  const logIds = (partialLogs.data ?? []).map((row) => String(row.id));

  if (automationIds.length) {
    const { error } = await db
      .from('automation_pending_executions')
      .update({ status: 'pending', run_at: nowIso })
      .in('id', automationIds)
      .eq('status', 'running');
    if (error) throw new Error(error.message);
  }
  if (flowIds.length) {
    const { error } = await db
      .from('flow_pending_executions')
      .update({ status: 'pending', run_at: nowIso })
      .in('id', flowIds)
      .eq('status', 'running');
    if (error) throw new Error(error.message);
  }

  let automationLogsSettled = 0;
  if (logIds.length) {
    const { data: active, error: activeError } = await db
      .from('automation_pending_executions')
      .select('log_id')
      .in('log_id', logIds)
      .in('status', ['pending', 'running']);
    if (activeError) throw new Error(activeError.message);
    const activeLogIds = new Set((active ?? []).map((row) => String(row.log_id)));
    const settledIds = logIds.filter((id) => !activeLogIds.has(id));
    if (settledIds.length) {
      const { error } = await db
        .from('automation_logs')
        .update({ status: 'success', error_message: null })
        .in('id', settledIds)
        .eq('status', 'partial');
      if (error) throw new Error(error.message);
      automationLogsSettled = settledIds.length;
    }
  }

  return {
    automationPendingReset: automationIds.length,
    flowPendingReset: flowIds.length,
    automationLogsSettled,
  };
}
