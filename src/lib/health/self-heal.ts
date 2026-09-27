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
  now = Date.now()
): boolean {
  if (!runAt) return false;
  const at = Date.parse(runAt);
  return Number.isFinite(at) && at <= now - RUNNING_GRACE_MS;
}

type HealResult = {
  automationPendingReset: number;
  flowPendingReset: number;
  automationLogsSettled: number;
  manualReview: number;
};

/**
 * Recupera únicamente estado interno que quedó tomado por un proceso muerto.
 * Sólo reencola flujos de plantillas con deduplicación persistente y pasos
 * internos repetibles. Las entregas inciertas sin esa protección requieren
 * revisión; nunca se inventa éxito ni se reenvía a ciegas.
 */
export async function healStalledWork(
  db: SupabaseClient,
  now = new Date()
): Promise<HealResult> {
  const nowIso = now.toISOString();
  const stalledBefore = new Date(
    now.getTime() - RUNNING_GRACE_MS
  ).toISOString();
  const partialBefore = new Date(
    now.getTime() - PARTIAL_SETTLE_GRACE_MS
  ).toISOString();

  const [automationRows, flowRows] = await Promise.all([
    db
      .from('automation_pending_executions')
      .select(
        'id, automations!inner(trigger_config, automation_steps(step_type))'
      )
      .eq('status', 'running')
      .lte('claimed_at', stalledBefore)
      .limit(100),
    db
      .from('flow_pending_executions')
      .select('id')
      .eq('status', 'running')
      .lte('claimed_at', stalledBefore)
      .limit(100),
  ]);

  if (automationRows.error) throw new Error(automationRows.error.message);
  if (flowRows.error) throw new Error(flowRows.error.message);

  const safe = (
    row: typeof automationRows.data extends (infer R)[] | null ? R : never
  ) => {
    const flow = row.automations as unknown as {
      trigger_config?: { session_template_fallback?: boolean };
      automation_steps?: { step_type: string }[];
    };
    const repeatable = new Set([
      'wait',
      'condition',
      'send_template',
      'set_context',
      'add_tag',
      'remove_tag',
      'update_contact_field',
    ]);
    return (
      flow?.trigger_config?.session_template_fallback === true &&
      Boolean(flow.automation_steps?.length) &&
      flow.automation_steps!.every((step) => repeatable.has(step.step_type))
    );
  };
  const automationIds = (automationRows.data ?? [])
    .filter(safe)
    .map((row) => String(row.id));
  const uncertainIds = (automationRows.data ?? [])
    .filter((row) => !safe(row))
    .map((row) => String(row.id));
  const flowIds = (flowRows.data ?? []).map((row) => String(row.id));
  let automationPendingReset = 0,
    manualReview = 0;

  if (automationIds.length) {
    const { data, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'pending', run_at: nowIso })
      .in('id', automationIds)
      .eq('status', 'running')
      .lte('claimed_at', stalledBefore)
      .select('id');
    if (error) throw new Error(error.message);
    automationPendingReset = data?.length ?? 0;
  }
  // Legacy workers have no durable outbound claim. A crash could follow a
  // successful send: mark for review, never blindly replay the customer message.
  for (const [table, ids] of [
    ['automation_pending_executions', uncertainIds],
    ['flow_pending_executions', flowIds],
  ] as const) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from(table)
      .update({ status: 'failed' })
      .in('id', ids)
      .eq('status', 'running')
      .lte('claimed_at', stalledBefore)
      .select('id');
    if (error) throw new Error(error.message);
    manualReview += data?.length ?? 0;
  }
  const settled = await db.rpc('settle_orphan_automation_logs', {
    p_before: partialBefore,
  });
  if (settled.error) throw new Error(settled.error.message);

  return {
    automationPendingReset,
    flowPendingReset: 0,
    automationLogsSettled: Number(settled.data ?? 0),
    manualReview,
  };
}
