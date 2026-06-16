import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/channels/registry";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { verifyChannelWebhook } from "@/lib/channels/verify-webhook";
import { getLogger } from "@/lib/log/logger";
import type { Channel, ChannelConnection } from "@/types";

const log = getLogger("channels.webhook");

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

  // Microsoft Graph validates a new subscription by POSTing to the
  // notification URL with a `validationToken` query param and expects
  // the decoded token echoed back as text/plain within 10s. This must
  // run before any body parsing — the validation POST has no JSON body.
  const validationToken = new URL(req.url).searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // Read the body ONCE as raw text. Meta signs the exact bytes — once
  // we let `request.json()` re-encode them the HMAC no longer matches.
  // The adapter receives the pre-parsed JSON so it doesn't have to
  // re-buffer the stream.
  const rawBody = await req.text();

  const verdict = await verifyChannelWebhook(channel, req, rawBody);
  if (!verdict.ok) {
    // Ack 200 even on bad signatures — re-driving an attacker's retries
    // (or amplifying a misconfigured-secret loop) gives the adversary
    // nothing useful. The operator pages on the warn log, not on
    // Meta's redelivery queue. Same pattern as the legacy WhatsApp
    // webhook (src/app/api/whatsapp/webhook/route.ts).
    //
    // Log enough diagnostic context to discriminate every failure mode
    // (SHA1-only header, missing header, wrong prefix, hmac mismatch)
    // without ever quoting the body — Meta payloads contain message
    // text and customer IDs (PII). Header diagnostics are sufficient.
    //
    // `connection_id` is read from the query string (NOT from the DB)
    // so an unauthenticated attacker spamming this endpoint can't force
    // us to do a DB roundtrip per rejection. That would be a DoS
    // amplifier.
    log.warn("rejected webhook delivery", {
      channel,
      reason: verdict.reason,
      detail: verdict.detail,
      connectionId: new URL(req.url).searchParams.get("connection_id"),
      rawBodyLength: rawBody.length,
      contentType: req.headers.get("content-type"),
      contentEncoding: req.headers.get("content-encoding"),
      hasSha1Header: !!req.headers.get("x-hub-signature"),
      hasSha256Header: !!req.headers.get("x-hub-signature-256"),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  let payload: unknown = null;
  if (rawBody.length > 0) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      log.warn("invalid JSON body after signature verify", { channel });
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }
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
      events = await adapter.parseWebhook(
        { request: req, rawBody, payload },
        connection,
      );
    } catch (err) {
      log.error("parseWebhook failed", {
        channel: c,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    processed = true;
    for (const event of events) {
      try {
        await ingestInboundEvent(db, event);
        ingested++;
      } catch (err) {
        log.error("ingest failed", {
          channel: c,
          error: err instanceof Error ? err.message : String(err),
        });
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
