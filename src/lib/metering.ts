import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * Usage metering helpers. All counts are scoped to the current calendar
 * month (UTC date_trunc), and use the service-role client so they bypass
 * RLS — call sites are expected to have already verified the caller has
 * access to the workspace.
 *
 * Conventions:
 *  - "outbound" messages = sender_type IN ('agent','bot'). The DB has no
 *    `direction` column; outbound is anything authored by a workspace
 *    member or its AI runtime (vs. 'customer' messages we receive).
 *  - AI replies = rows in ai_replies with status='sent' (skipped /
 *    failed dispatches don't count against the AI quota).
 */

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function countMessagesSentThisMonth(
  workspaceId: string,
): Promise<number> {
  const admin = supabaseAdmin();
  // Messages don't carry workspace_id; they inherit it from their
  // parent conversation. PostgREST exposes the FK as an embedded
  // filter — `conversations.workspace_id=eq.X` keeps the count cheap.
  const { count, error } = await admin
    .from("messages")
    .select("id, conversations!inner(workspace_id)", {
      count: "exact",
      head: true,
    })
    .eq("conversations.workspace_id", workspaceId)
    .in("sender_type", ["agent", "bot"])
    .gte("created_at", monthStartIso());
  if (error) {
    console.error("[metering] countMessagesSentThisMonth:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function countAiRepliesThisMonth(
  workspaceId: string,
): Promise<number> {
  const admin = supabaseAdmin();
  const { count, error } = await admin
    .from("ai_replies")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "sent")
    .gte("created_at", monthStartIso());
  if (error) {
    console.error("[metering] countAiRepliesThisMonth:", error.message);
    return 0;
  }
  return count ?? 0;
}

export interface UsageSummary {
  messages_sent: number;
  ai_replies: number;
  period_start: string;
}

export async function getUsageSummary(workspaceId: string): Promise<UsageSummary> {
  const [messages_sent, ai_replies] = await Promise.all([
    countMessagesSentThisMonth(workspaceId),
    countAiRepliesThisMonth(workspaceId),
  ]);
  return {
    messages_sent,
    ai_replies,
    period_start: monthStartIso(),
  };
}
