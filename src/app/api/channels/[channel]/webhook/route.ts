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

  const connection = await loadConnection(req, channel);
  if (!connection) {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }

  const adapter = getAdapter(channel);
  let events;
  try {
    events = await adapter.parseWebhook(req.clone(), connection);
  } catch (err) {
    console.error(`[channels/${channel}] parseWebhook failed:`, err);
    // Always 200 — platforms retry on non-2xx and we'd rather log + drop
    // than enter an exponential-backoff loop.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();
  for (const event of events) {
    try {
      await ingestInboundEvent(db, event);
    } catch (err) {
      console.error(`[channels/${channel}] ingest failed:`, err);
    }
  }
  return NextResponse.json({ ok: true, ingested: events.length });
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
