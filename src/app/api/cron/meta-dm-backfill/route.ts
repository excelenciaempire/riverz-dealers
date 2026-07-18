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

    // Descubrir hilos que el COMERCIO inició desde la app (a alguien que nunca
    // escribió), invisibles para el loop de contactos porque aún no existen en
    // Riverz. Solo se crean si el participante NO tiene contacto todavía, así
    // no revive conversaciones borradas (esas conservan su contacto).
    try {
      ingested += await discoverNewThreads({ token, pageId, selfId, platform, connection: c });
    } catch (err) {
      console.warn(
        `[meta-dm-backfill] ${c.channel} discover new threads failed:`,
        err instanceof Error ? err.message : err,
      );
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
  const threadId = await resolveThreadId(args.token, args.pageId, args.platform, externalId);
  if (!threadId) return 0;

  // 2. Fill outbound gaps in this EXISTING thread — createIfMissing:false so an
  //    old outbound message never recreates a conversation the user deleted.
  return backfillThreadMessages({
    token: args.token,
    selfId: args.selfId,
    connection: args.connection,
    threadId,
    externalId,
    contactName: args.contact.name ?? undefined,
    createIfMissing: false,
  });
}

/** Resolve the Page conversation thread id for a given user (PSID/IGSID). */
async function resolveThreadId(
  token: string,
  pageId: string,
  platform: "messenger" | "instagram",
  userId: string,
): Promise<string | null> {
  const convUrl = new URL(`${GRAPH}/${pageId}/conversations`);
  convUrl.searchParams.set("platform", platform);
  convUrl.searchParams.set("user_id", userId);
  convUrl.searchParams.set("access_token", token);
  const proof = appsecretProof(token);
  if (proof) convUrl.searchParams.set("appsecret_proof", proof);
  const r = await fetch(convUrl.toString());
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { id?: string }[] };
  return j.data?.[0]?.id ?? null;
}

interface ThreadBackfillArgs {
  token: string;
  selfId: string;
  connection: ChannelConnection;
  threadId: string;
  externalId: string;
  contactName?: string;
  /** true only for genuinely new merchant-initiated threads (see
   *  discoverNewThreads); false fills gaps in threads that already exist. */
  createIfMissing: boolean;
}

/**
 * Page a thread newest-first (cap 4×50=200, 30-day window) and re-ingest the
 * OUTBOUND messages (from === our page/IG id) — the merchant's replies sent
 * outside Riverz. Inbound already arrives via webhook, so it's skipped. The
 * unique index on message_id makes overlap free.
 */
async function backfillThreadMessages(args: ThreadBackfillArgs): Promise<number> {
  const cutoffMs = Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let url: string | null =
    `${GRAPH}/${args.threadId}/messages?fields=id,from,message,created_time&limit=50&access_token=${encodeURIComponent(args.token)}`;
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
      // Outbound = the page / IG account itself sent it.
      if (m.from?.id !== args.selfId) continue;
      await ingestInboundEvent(admin, {
        channel: args.connection.channel,
        connection: args.connection,
        externalContactId: args.externalId,
        contactName: args.contactName,
        externalMessageId: m.id,
        text: m.message ?? "",
        receivedAt: m.created_time ?? new Date().toISOString(),
        outbound: true,
        createIfMissing: args.createIfMissing,
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

interface DiscoverArgs {
  token: string;
  pageId: string;
  selfId: string;
  platform: "messenger" | "instagram";
  connection: ChannelConnection;
}

/**
 * Discover threads the MERCHANT started from the native app to someone who
 * never messaged us (so there's no Riverz contact yet, and the per-contact
 * loop never sees them). Lists the page's conversations, and for each thread
 * whose customer participant has NO contact, backfills the merchant's outbound
 * messages with createIfMissing:true. Guard: skipping participants that
 * already have a contact means a soft-deleted conversation (which keeps its
 * contact) is never resurrected.
 */
async function discoverNewThreads(args: DiscoverArgs): Promise<number> {
  const admin = supabaseAdmin();
  let url: string | null = `${GRAPH}/${args.pageId}/conversations?platform=${args.platform}&fields=id,participants&limit=50&access_token=${encodeURIComponent(args.token)}`;
  let pages = 0;
  let ingested = 0;
  while (url && pages < 3) {
    const r: Response = await fetch(withAppsecretProof(url, args.token));
    if (!r.ok) break;
    const j = (await r.json()) as {
      data?: {
        id?: string;
        participants?: { data?: { id?: string }[] };
      }[];
      paging?: { next?: string };
    };
    for (const conv of j.data ?? []) {
      if (!conv.id) continue;
      // The participant that isn't us is the customer.
      const other = (conv.participants?.data ?? [])
        .map((p) => String(p.id ?? ""))
        .find((id) => id && id !== args.selfId && id !== args.pageId);
      if (!other) continue;
      // Already known → the per-contact loop handles it (and respects any
      // soft-delete). Only genuinely-new participants are discovered here.
      const { data: existing } = await admin
        .from("contacts")
        .select("id")
        .eq("workspace_id", args.connection.workspace_id)
        .eq("channel", args.connection.channel)
        .eq("external_id", other)
        .maybeSingle();
      if (existing) continue;
      ingested += await backfillThreadMessages({
        token: args.token,
        selfId: args.selfId,
        connection: args.connection,
        threadId: conv.id,
        externalId: other,
        createIfMissing: true,
      });
    }
    url = j.paging?.next ?? null;
    pages++;
  }
  return ingested;
}
