import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/channels/registry";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import type { Channel, ChannelConnection } from "@/types";

const VALID: Channel[] = [
  "whatsapp",
  "instagram",
  "messenger",
  "gmail",
  "outlook",
  "fb_comment",
  "ig_comment",
];

/**
 * Unified webhook entry point — `/api/channels/:channel/webhook`.
 *
 *   GET  ?connection_id=…&hub.…  → handshake echo
 *   POST                          → ingest events into the unified inbox
 *
 * The handler picks the right adapter from the registry and never
 * touches platform-specific code itself.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ channel: string }> },
): Promise<Response> {
  const { channel } = await ctx.params;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: "unknown channel" }, { status: 404 });
  }

  // Meta-portal handshake: when an admin registers this URL in the
  // developer portal there are no channel_connections yet, so we
  // verify against META_WEBHOOK_VERIFY_TOKEN directly without
  // requiring a stored connection. Other channels (and rotated
  // per-connection secrets) still go through the adapter.
  const url = new URL(req.url);
  const isMetaHandshake =
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token");
  if (isMetaHandshake) {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    const supplied = url.searchParams.get("hub.verify_token");
    if (expected && supplied === expected) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
  }

  const connection = await loadConnection(req, channel);
  if (!connection) return new Response("not found", { status: 404 });

  const adapter = getAdapter(channel);
  if (!adapter.verifyWebhookHandshake) {
    return new Response("ok", { status: 200 });
  }
  const challenge = await adapter.verifyWebhookHandshake(req, connection);
  if (challenge === null) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ channel: string }> },
): Promise<Response> {
  const { channel } = await ctx.params;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: "unknown channel" }, { status: 404 });
  }

  // Meta delivers ONE webhook per object: page → messaging + feed (DMs +
  // FB comments), instagram → messaging + comments (DMs + IG comments).
  // Run every related adapter so a single delivery hits both the DM
  // pipeline and the comments pipeline even though they live under
  // different connection rows.
  const adapterChannels = relatedChannels(channel);

  const db = supabaseAdmin();
  let ingested = 0;
  let processed = false;
  for (const c of adapterChannels) {
    const connection = await loadConnection(req, c);
    if (!connection) continue;
    const adapter = getAdapter(c);
    let events;
    try {
      events = await adapter.parseWebhook(req.clone(), connection);
    } catch (err) {
      console.error(`[channels/${c}] parseWebhook failed:`, err);
      continue;
    }
    processed = true;
    for (const event of events) {
      try {
        await ingestInboundEvent(db, event);
        ingested++;
      } catch (err) {
        console.error(`[channels/${c}] ingest failed:`, err);
      }
    }
  }
  if (!processed) {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ingested });
}

/**
 * Channels that may carry events for the given URL channel. Meta sends
 * one webhook per object even when it covers two of our internal
 * channels (page = messenger + fb_comment, instagram = instagram +
 * ig_comment), so we run both adapters and let each parser ignore the
 * events it doesn't care about.
 */
function relatedChannels(channel: Channel): Channel[] {
  if (channel === "messenger" || channel === "fb_comment") {
    return ["messenger", "fb_comment"];
  }
  if (channel === "instagram" || channel === "ig_comment") {
    return ["instagram", "ig_comment"];
  }
  return [channel];
}

function isChannel(x: string): x is Channel {
  return (VALID as string[]).includes(x);
}

async function loadConnection(
  req: Request,
  channel: Channel,
): Promise<ChannelConnection | null> {
  const url = new URL(req.url);
  const id = url.searchParams.get("connection_id");
  if (!id) {
    // Single-connection fallback for legacy webhooks that don't include
    // the id in the URL: pick the first connected one for this channel.
    const { data } = await supabaseAdmin()
      .from("channel_connections")
      .select("*")
      .eq("channel", channel)
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();
    return (data as ChannelConnection | null) ?? null;
  }
  const { data } = await supabaseAdmin()
    .from("channel_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ChannelConnection | null) ?? null;
}
