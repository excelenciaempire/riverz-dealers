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
  } | null;
  const workspaceId = body?.workspace_id?.trim();
  const days = Number(body?.days);
  const selected = (body?.channels ?? []).filter(
    (channel): channel is BackfillChannel => (CHANNELS as readonly string[]).includes(channel),
  );
  if (!workspaceId || !Number.isInteger(days) || days < 1 || days > 3650 || !selected.length) {
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
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = await Promise.all(connections.map((connection) => pullConnection(connection, sinceIso)));
  return NextResponse.json({ ok: true, ingested: result.reduce((sum, item) => sum + item.ingested, 0), detail: result });
}

async function pullConnection(connection: ChannelConnection, sinceIso: string) {
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
    const response = await fetch(withAppsecretProof(url, token));
    if (!response.ok) return { channel: connection.channel, ingested, error: `graph_${response.status}` };
    const data = (await response.json()) as { data?: GraphConversation[]; paging?: { next?: string } };
    for (const thread of data.data ?? []) {
      const updated = Date.parse(String(thread.updated_time ?? ""));
      if (Number.isFinite(updated) && updated < since) return { channel: connection.channel, ingested };
      const other = (thread.participants?.data ?? []).find((participant) => participant.id && participant.id !== selfId && participant.id !== pageId);
      if (!thread.id || !other?.id) continue;
      ingested += await syncThreadMessages({
        token,
        selfId,
        connection,
        threadId: thread.id,
        externalId: other.id,
        contactName: other.username ? `@${other.username}` : other.name,
        createIfMissing: true,
        sinceIso,
        maxPages: 100,
      });
    }
    url = data.paging?.next ? withAppsecretProof(data.paging.next, token) : null;
  }
  return { channel: connection.channel, ingested };
}
