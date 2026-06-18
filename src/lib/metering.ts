import { fromZonedTime } from "date-fns-tz";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * Usage metering helpers. All counts are scoped to the current calendar
 * month in the WORKSPACE timezone (the app's single reporting zone), and use
 * the service-role client so they bypass RLS — call sites are expected to
 * have already verified the caller has access to the workspace, and to pass
 * the workspace's tz.
 *
 * Conventions:
 *  - "outbound" messages = sender_type IN ('agent','bot'). The DB has no
 *    `direction` column; outbound is anything authored by a workspace
 *    member or its AI runtime (vs. 'customer' messages we receive).
 *  - AI replies = rows in ai_replies with status='sent' (skipped /
 *    failed dispatches don't count against the AI quota).
 */

/** First instant of the current month, as seen in `tz`, as a UTC ISO string. */
function monthStartIso(tz: string): string {
  // en-CA → "2026-06" for year+month in tz; reinterpret day 1 at 00:00 in tz.
  const ym = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  return fromZonedTime(`${ym}-01T00:00:00`, tz).toISOString();
}

export async function countMessagesSentThisMonth(
  workspaceId: string,
  tz: string,
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
    .gte("created_at", monthStartIso(tz));
  if (error) {
    console.error("[metering] countMessagesSentThisMonth:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function countAiRepliesThisMonth(
  workspaceId: string,
  tz: string,
): Promise<number> {
  const admin = supabaseAdmin();
  const { count, error } = await admin
    .from("ai_replies")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "sent")
    .gte("created_at", monthStartIso(tz));
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

export async function getUsageSummary(
  workspaceId: string,
  tz: string = DEFAULT_TIMEZONE,
): Promise<UsageSummary> {
  const [messages_sent, ai_replies] = await Promise.all([
    countMessagesSentThisMonth(workspaceId, tz),
    countAiRepliesThisMonth(workspaceId, tz),
  ]);
  return {
    messages_sent,
    ai_replies,
    period_start: monthStartIso(tz),
  };
}
