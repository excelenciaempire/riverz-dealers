import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import { assertCronAuth } from "@/lib/auth/cron";
import { appsecretProof, withAppsecretProof } from "@/lib/channels/meta-graph";
import type { ChannelConnection, Contact } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";

// Only backfill recent external agent replies. Meta returns messages newest
// first, so we stop paging a thread once we cross this window. Re-pulling
// months of ancient one-sided history every run just re-confirms messages we
// already have (createIfMissing:false won't recreate deleted threads anyway) —
// the value is surfacing replies a human just sent from Business Suite.
const BACKFILL_WINDOW_DAYS = 30;

/**
 * GET /api/cron/meta-dm-backfill
 *
 * Pulls the full message history for every existing Messenger and
 * Instagram contact from Meta's Graph API and ingests anything we're
 * missing — in particular agent replies the team sent from Meta
 * Business Suite (or any other tool) that never went through this CRM.
 *
 * For each contact:
 *   1. Find the conversation thread via /{page_id|ig_user_id}/conversations
 *      keyed by the contact's PSID / IGSID.
 *   2. Fetch /{thread_id}/messages with from + message + created_time.
 *   3. Re-ingest each message; the unique index on messages.message_id
 *      makes existing rows a no-op, so this is idempotent.
 *
 * Auth: `x-cron-secret` matches AUTOMATION_CRON_SECRET.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const { data: connections } = await admin
    .from("channel_connections")
    .select("*")
    .in("channel", ["messenger", "instagram"])
    .eq("status", "connected");
  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const results: Array<{
    connection_id: string;
    channel: string;
    ingested: number;
    error?: string;
  }> = [];

  for (const c of connections as ChannelConnection[]) {
    const cfg = (c.config ?? {}) as Record<string, unknown>;
    const secrets = (c.secrets ?? {}) as Record<string, unknown>;
    const enc = String(secrets.access_token ?? "");
    if (!enc) {
      results.push({ connection_id: c.id, channel: c.channel, ingested: 0, error: "no token" });
      continue;
    }
    const token = decrypt(enc);

    const isMessenger = c.channel === "messenger";
    // Graph lists conversations off the PAGE for both Messenger and
    // Instagram (the latter via platform=instagram). The "self" id for
    // detecting outbound messages differs though: messenger uses the
    // page id, IG uses the IG user id.
    const pageId = String(cfg.page_id ?? "");
    const selfId = isMessenger ? pageId : String(cfg.ig_user_id ?? "");
    const platform = isMessenger ? "messenger" : "instagram";
    if (!pageId || !selfId) {
      results.push({ connection_id: c.id, channel: c.channel, ingested: 0, error: "missing ids" });
      continue;
    }

    const { data: contacts } = await admin
      .from("contacts")
      .select("*")
      .eq("workspace_id", c.workspace_id)
      .eq("channel", c.channel);

    let ingested = 0;
    for (const contact of (contacts ?? []) as Contact[]) {
      try {
        const n = await backfillContact({
          token,
          pageId,
          selfId,
          platform,
          connection: c,
          contact,
        });
        ingested += n;
      } catch (err) {
        console.warn(
          `[meta-dm-backfill] ${c.channel} contact ${contact.external_id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    results.push({ connection_id: c.id, channel: c.channel, ingested });
  }

  return NextResponse.json({ ok: true, results });
}

interface BackfillArgs {
  token: string;
  pageId: string;
  selfId: string;
  platform: "messenger" | "instagram";
  connection: ChannelConnection;
  contact: Contact;
}

async function backfillContact(args: BackfillArgs): Promise<number> {
  const externalId = args.contact.external_id;
  if (!externalId) return 0;
  // 1. Resolve the thread id for this contact. Both messenger and
  //    instagram conversations are listed off the Page id with the
  //    platform query param.
  const convUrl = new URL(`${GRAPH}/${args.pageId}/conversations`);
  convUrl.searchParams.set("platform", args.platform);
  convUrl.searchParams.set("user_id", externalId);
  convUrl.searchParams.set("access_token", args.token);
  const proof = appsecretProof(args.token);
  if (proof) convUrl.searchParams.set("appsecret_proof", proof);
  const convRes = await fetch(convUrl.toString());
  if (!convRes.ok) return 0;
  const convJson = (await convRes.json()) as { data?: { id?: string }[] };
  const threadId = convJson.data?.[0]?.id;
  if (!threadId) return 0;

  // 2. Page through messages, newest first. We cap at 200 to keep this
  //    bounded for chatty contacts; the unique index makes overlap free.
  const cutoffMs = Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let url: string | null =
    `${GRAPH}/${threadId}/messages?fields=id,from,message,created_time&limit=50&access_token=${encodeURIComponent(args.token)}`;
  let pages = 0;
  let ingested = 0;
  let reachedCutoff = false;
  const admin = supabaseAdmin();
  while (url && pages < 4) {
    // `paging.next` carries no proof — re-attach each page.
    const r: Response = await fetch(withAppsecretProof(url, args.token));
    if (!r.ok) break;
    const j = (await r.json()) as {
      data?: {
        id?: string;
        from?: { id?: string };
        message?: string;
        created_time?: string;
      }[];
      paging?: { next?: string };
    };
    for (const m of j.data ?? []) {
      // Newest-first: the first message older than the window means every
      // remaining message (this page + later pages) is older too — stop.
      if (m.created_time && new Date(m.created_time).getTime() < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      if (!m.id) continue;
      const fromId = m.from?.id;
      // Outbound = the page / IG account itself sent it.
      const isOutbound = fromId === args.selfId;
      // For inbound we already have it through the webhook; only fill
      // outbound gaps here (the whole reason for this backfill).
      if (!isOutbound) continue;
      await ingestInboundEvent(admin, {
        channel: args.connection.channel,
        connection: args.connection,
        externalContactId: externalId,
        contactName: args.contact.name ?? undefined,
        externalMessageId: m.id,
        text: m.message ?? "",
        receivedAt: m.created_time ?? new Date().toISOString(),
        outbound: true,
        // Only fill gaps in threads that still exist — never let an old
        // outbound message recreate a conversation the user deleted from
        // the inbox (that 6-hourly resurrection was the whole bug).
        createIfMissing: false,
        raw: { backfill: true },
      });
      ingested++;
    }
    if (reachedCutoff) break;
    url = j.paging?.next ?? null;
    pages++;
  }
  return ingested;
}
