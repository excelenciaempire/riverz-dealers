import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { listConnections } from "@/lib/channels/connections";
import { decrypt } from "@/lib/channels/encryption";
import { syncThreadMessages, type MetaPlatform } from "@/lib/channels/meta-dm-history";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { csrfGuard } from "@/lib/csrf";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { ChannelConnection } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";
const GRAPH_TIMEOUT_MS = 30_000;
const CHANNELS = ["facebook", "instagram"] as const;
type BackfillChannel = (typeof CHANNELS)[number];

interface GraphConversation {
  id?: string;
  updated_time?: string;
  participants?: { data?: Array<{ id?: string; name?: string; username?: string }> };
}

/** Recupera el historial de DMs de Facebook e Instagram sin disparar IA. */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: translate(locale, "errInbox.unauthorized") }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string; days?: number; channels?: string[];
    date_from?: string; date_to?: string; all_history?: boolean;
  } | null;
  const workspaceId = body?.workspace_id?.trim();
  const days = Number(body?.days);
  const fromMs = dateBoundary(body?.date_from, false);
  const untilMs = dateBoundary(body?.date_to, true);
  const allHistory = body?.all_history === true;
  const selected = (body?.channels ?? []).filter(
    (channel): channel is BackfillChannel => (CHANNELS as readonly string[]).includes(channel),
  );
  const validDays = Number.isInteger(days) && days >= 1 && days <= 3650;
  if (!workspaceId || !selected.length || (!allHistory && !validDays && fromMs === undefined) || fromMs === null || untilMs === null || (fromMs !== undefined && untilMs !== undefined && fromMs > untilMs)) {
    return NextResponse.json({ error: translate(locale, "errInbox.backfillInvalid") }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(String(membership.role))) {
    return NextResponse.json({ error: translate(locale, "errInbox.forbiddenAdminOnly") }, { status: 403 });
  }

  const connectionChannels: Array<"messenger" | "instagram"> = selected.map(
    (channel) => (channel === "facebook" ? "messenger" : "instagram"),
  );
  const connections = await listConnections(admin, {
    workspaceId,
    channels: connectionChannels,
    statuses: ["connected"],
  });
  const startMs = allHistory ? 0 : fromMs ?? Date.now() - days * 86_400_000;
  const sinceIso = new Date(startMs).toISOString();
  const untilIso = new Date(untilMs ?? Date.now()).toISOString();
  const result = await Promise.all(
    connections.map(async (connection) => {
      try {
        return await pullConnection(connection, sinceIso, untilIso);
      } catch (error) {
        console.error("[messages/backfill] connection recovery failed", {
          connectionId: connection.id,
          error,
        });
        return { channel: connection.channel, ingested: 0, error: "connection_failed" };
      }
    }),
  );
  const complete = result.every((item) => !item.error);
  return NextResponse.json({
    ok: complete,
    complete,
    partial: !complete,
    ingested: result.reduce((sum, item) => sum + item.ingested, 0),
    detail: result,
  });
}

async function pullConnection(connection: ChannelConnection, sinceIso: string, untilIso: string) {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encrypted = String(secrets.access_token ?? "");
  const pageId = String(config.page_id ?? "");
  const instagram = connection.channel === "instagram";
  const selfId = instagram ? String(config.ig_user_id ?? "") : pageId;
  if (!encrypted || !pageId || !selfId) return { channel: connection.channel, ingested: 0, error: "missing_config" };

  const token = decrypt(encrypted);
  const platform: MetaPlatform = instagram ? "instagram" : "messenger";
  const since = Date.parse(sinceIso);
  let ingested = 0;
  let url: string | null = `${GRAPH}/${pageId}/conversations?platform=${platform}&fields=id,updated_time,participants&limit=100&access_token=${encodeURIComponent(token)}`;

  while (url) {
    let response: Response;
    try {
      response = await fetch(withAppsecretProof(url, token), {
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
    } catch (error) {
      console.error("[messages/backfill] Graph conversation discovery failed", {
        connectionId: connection.id,
        error,
      });
      return { channel: connection.channel, ingested, error: "graph_timeout" };
    }
    if (!response.ok) return { channel: connection.channel, ingested, error: `graph_${response.status}` };
    const data = (await response.json()) as { data?: GraphConversation[]; paging?: { next?: string } };
    for (const thread of data.data ?? []) {
      const updated = Date.parse(String(thread.updated_time ?? ""));
      if (Number.isFinite(updated) && updated < since) return { channel: connection.channel, ingested };
      const other = (thread.participants?.data ?? []).find((participant) => participant.id && participant.id !== selfId && participant.id !== pageId);
      if (!thread.id || !other?.id) continue;
      try {
        ingested += await syncThreadMessages({
          token,
          selfId,
          connection,
          threadId: thread.id,
          externalId: other.id,
          contactName: other.username ? `@${other.username}` : other.name,
          createIfMissing: true,
          sinceIso,
          untilIso,
          maxPages: Number.MAX_SAFE_INTEGER,
        });
      } catch (error) {
        console.error("[messages/backfill] Graph thread recovery failed", {
          connectionId: connection.id,
          threadId: thread.id,
          error,
        });
        return { channel: connection.channel, ingested, error: "graph_thread_failed" };
      }
    }
    url = data.paging?.next ? withAppsecretProof(data.paging.next, token) : null;
  }
  return { channel: connection.channel, ingested };
}

function dateBoundary(value: string | undefined, end: boolean): number | undefined | null {
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}
