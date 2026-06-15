import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { assertCronAuth } from "@/lib/auth/cron";
import {
  failRunFromRetry,
  nextRetryDelayMs,
  retrySendNode,
} from "@/lib/flows/engine";
import type { FlowNodeRow, FlowRunRow } from "@/lib/flows/types";

/**
 * Drena la cola de reintentos de sends interactivos (botones / lista)
 * que fallaron de forma transitoria. El runner persiste cada falla en
 * `flow_pending_retries` con `attempt=0` y `run.status='paused_for_retry'`.
 * Este endpoint, llamado periódicamente con `x-cron-secret`, levanta las
 * filas vencidas, reintenta el send, y:
 *   - si funciona: borra la fila y restaura el run a 'active'.
 *   - si falla y quedan intentos: re-agenda con backoff exponencial
 *     (60s, 5min, 30min, 2h, 6h).
 *   - si falla y ya gastó max_attempts: marca el run como 'failed'.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "FLOWS_RETRY_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from("flow_pending_retries")
    .select("*")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  type Row = {
    id: string;
    flow_run_id: string;
    node_key: string;
    attempt: number;
    max_attempts: number;
    retry_kind: "send_buttons" | "send_list" | null;
  };

  let processed = 0;
  for (const row of due as Row[]) {
    if (row.attempt >= row.max_attempts) {
      await admin.from("flow_pending_retries").delete().eq("id", row.id);
      await failRunFromRetry(row.flow_run_id, "send_retry_exhausted");
      continue;
    }

    const { data: runData } = await admin
      .from("flow_runs")
      .select("*")
      .eq("id", row.flow_run_id)
      .maybeSingle();
    if (!runData) {
      await admin.from("flow_pending_retries").delete().eq("id", row.id);
      continue;
    }
    const run = runData as FlowRunRow;
    if (run.status !== "paused_for_retry" && run.status !== "active") {
      await admin.from("flow_pending_retries").delete().eq("id", row.id);
      continue;
    }

    const callStack = Array.isArray(run.call_stack) ? run.call_stack : [];
    const activeFlowId =
      callStack.length > 0
        ? callStack[callStack.length - 1].flow_id
        : run.flow_id;
    const { data: nodeData } = await admin
      .from("flow_nodes")
      .select("*")
      .eq("flow_id", activeFlowId)
      .eq("node_key", row.node_key)
      .maybeSingle();
    if (!nodeData) {
      await admin.from("flow_pending_retries").delete().eq("id", row.id);
      await failRunFromRetry(row.flow_run_id, "retry_node_not_found");
      continue;
    }
    const node = nodeData as FlowNodeRow;
    const retryKind =
      row.retry_kind ??
      (node.node_type === "send_list" ? "send_list" : "send_buttons");

    const result = await retrySendNode({ run, node, retryKind });
    if (result.ok) {
      await admin.from("flow_pending_retries").delete().eq("id", row.id);
      processed += 1;
      continue;
    }

    const nextAttempt = row.attempt + 1;
    if (nextAttempt >= row.max_attempts) {
      await admin.from("flow_pending_retries").delete().eq("id", row.id);
      await failRunFromRetry(row.flow_run_id, "send_retry_exhausted");
      continue;
    }
    const delay = nextRetryDelayMs(nextAttempt);
    const nextRunAt = new Date(Date.now() + delay).toISOString();
    await admin
      .from("flow_pending_retries")
      .update({
        attempt: nextAttempt,
        run_at: nextRunAt,
        last_error: result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }

  return NextResponse.json({ processed });
}
