import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/channels/registry";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { verifyChannelWebhook } from "@/lib/channels/verify-webhook";
import { getLogger } from "@/lib/log/logger";
import { captureWebhookFailure } from "@/lib/webhooks/capture";
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
  "mercadolibre",
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

  // Wrap the rest in a top-level try/catch. Any uncaught exception
  // (Supabase outage during loadConnection, adapter throwing on an
  // unexpected payload shape) used to bubble to Next.js → 500. Meta then
  // puts the delivery into exponential-backoff retries, and after ~7d
  // of sustained 5xx it auto-unsubscribes the field. We page on the log
  // line, never on Meta's redelivery queue.
  try {
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

    // Fire-and-forget the heavy ingestion work so we ack Meta inside
    // the 5s budget. parseWebhook can do Graph lookups for sender names
    // and download media for every attachment, which under a burst can
    // exceed Meta's 5s timeout → retry queue → duplicate processing →
    // re-fired automations. The legacy WhatsApp webhook has the same
    // posture (src/app/api/whatsapp/webhook/route.ts:190).
    const explicitId = new URL(req.url).searchParams.get("connection_id");
    void processChannelsWebhookAsync(channel, req, rawBody, payload, explicitId).catch(
      (err) => {
        log.error("channels webhook async processing failed", {
          channel,
          error: err instanceof Error ? err.message : String(err),
        });
        // The signature already verified, so this is OUR failure (DB
        // outage, adapter throw). Capture the raw delivery so it isn't
        // silently lost — see webhook_events_raw (migration 059).
        void captureWebhookFailure({
          provider: `channels:${channel}`,
          rawBody,
          signature: req.headers.get("x-hub-signature-256"),
          error: err,
        });
      },
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Never 5xx back to Meta — it triggers exponential-backoff retries
    // and, after ~7d of sustained failures, auto-unsubscribes the field.
    log.error("webhook handler threw", {
      channel,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }
}

async function processChannelsWebhookAsync(
  channel: Channel,
  req: Request,
  rawBody: string,
  payload: unknown,
  explicitId: string | null,
): Promise<void> {
  // Meta delivers ONE webhook per object: page → messaging + feed (DMs +
  // FB comments), instagram → messaging + comments (DMs + IG comments).
  // Run every related adapter so a single delivery hits both the DM
  // pipeline and the comments pipeline even though they live under
  // different connection rows.
  const adapterChannels = relatedChannels(channel);
  const db = supabaseAdmin();
  for (const c of adapterChannels) {
    const routes = explicitId
      ? await routesForExplicitId(explicitId, payload)
      : await routesByPayload(c, payload);
    if (routes.length === 0) continue;

    const adapter = getAdapter(c);
    for (const route of routes) {
      let events;
      try {
        events = await adapter.parseWebhook(
          { request: req, rawBody, payload: route.payload },
          route.connection,
        );
      } catch (err) {
        log.error("parseWebhook failed", {
          channel: c,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      for (const event of events) {
        try {
          await ingestInboundEvent(db, event);
        } catch (err) {
          log.error("ingest failed", {
            channel: c,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
}

/** One slice of a webhook delivery: the connection that owns it plus the
 *  (possibly entry-filtered) payload the adapter should parse for it. */
interface DeliveryRoute {
  connection: ChannelConnection;
  payload: unknown;
}

/** Explicit ?connection_id=… path: load that one row and hand it the
 *  whole payload (the caller asserted which connection this is for). */
async function routesForExplicitId(
  id: string,
  payload: unknown,
): Promise<DeliveryRoute[]> {
  const { data } = await supabaseAdmin()
    .from("channel_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const connection = data as ChannelConnection | null;
  return connection ? [{ connection, payload }] : [];
}

/**
 * No connection_id in the URL — route by payload. Loads every connected
 * connection for the channel and attributes each top-level `entry[]` to
 * EVERY connection whose page_id / ig_user_id (or WhatsApp
 * phone_number_id) it carries — the same account in two workspaces gets
 * both copies. One connection → whole payload (the common case, zero
 * overhead). Entries we can't attribute are dropped (never guessed) to
 * avoid cross-tenant leakage.
 */
async function routesByPayload(
  channel: Channel,
  payload: unknown,
): Promise<DeliveryRoute[]> {
  // Accept connections that are flagged error/expired too — Meta keeps
  // delivering webhooks even when a token is dead (the subscription is
  // app-level, not token-level), and the token isn't needed to ingest
  // the inbound text. Dropping these would silently lose customer
  // messages until a manual reconnect. Only 'disconnected'/'pending'
  // (admin-off or mid-setup) are excluded.
  const { data } = await supabaseAdmin()
    .from("channel_connections")
    .select("*")
    .eq("channel", channel)
    .in("status", ["connected", "error", "expired"]);
  const conns = (data ?? []) as ChannelConnection[];
  if (conns.length === 0) return [];

  // MercadoLibre notifications are FLAT ({resource, user_id, topic} — no
  // entry[]). Route by the seller user_id → EVERY matching connection (the
  // same seller may legitimately live in more than one workspace); NEVER
  // fall back to conns[0] (that would leak one seller's messages into another
  // workspace). Drop unmatched.
  if (channel === "mercadolibre") {
    const uid = String((payload as { user_id?: unknown })?.user_id ?? "");
    const matches = conns.filter(
      (c) =>
        String(c.external_account_id ?? "") === uid ||
        String((c.config as Record<string, unknown> | null)?.seller_id ?? "") === uid,
    );
    if (matches.length === 0) {
      log.warn("mercadolibre notification matched no seller connection — DROPPED", { uid });
      return [];
    }
    return matches.map((conn) => ({ connection: conn, payload }));
  }

  // Outlook Graph notifications are FLAT too ({value:[…]} — no entry[]).
  // Each item carries the subscriptionId we stored on the connection at
  // watch time; route every item to ITS mailbox instead of conns[0]
  // (which with 2+ mailboxes fetched the message with the wrong token
  // and silently dropped it).
  if (channel === "outlook") {
    const items = Array.isArray((payload as { value?: unknown })?.value)
      ? ((payload as { value: unknown[] }).value as Array<Record<string, unknown>>)
      : [];
    if (items.length > 0) {
      const routes: DeliveryRoute[] = [];
      for (const c of conns) {
        const subId = String(
          (c.config as Record<string, unknown> | null)?.subscription_id ?? "",
        );
        if (!subId) continue;
        const mine = items.filter((n) => String(n.subscriptionId ?? "") === subId);
        if (mine.length > 0) {
          routes.push({
            connection: c,
            payload: { ...(payload as object), value: mine },
          });
        }
      }
      if (routes.length > 0) return routes;
      // No subscription matched (e.g. rows armed before subscription_id was
      // stored): only safe to guess when there is exactly one mailbox.
      if (conns.length === 1) return [{ connection: conns[0], payload }];
      log.warn("outlook notification matched no subscription_id — DROPPED", {
        subscriptionIds: items.map((n) => String(n.subscriptionId ?? "")),
      });
      return [];
    }
  }

  const body = (payload ?? {}) as { entry?: unknown };
  const entries = Array.isArray(body.entry) ? body.entry : [];
  // Single connection or no entries to discriminate on → give it
  // everything, exactly like the legacy single-connection path.
  if (conns.length === 1 || entries.length === 0) {
    return [{ connection: conns[0], payload }];
  }

  const buckets = new Map<string, DeliveryRoute & { entries: unknown[] }>();
  const unmatched: unknown[] = [];
  for (const entry of entries) {
    // EVERY matching connection gets the entry — the same page/IG account
    // can legitimately be connected in more than one workspace, and
    // first-match-wins silently starved all but one of them. Within one
    // workspace duplicates can't happen (uq_active_connection_per_account).
    const matches = conns.filter((c) => connectionMatchesEntry(channel, c, entry));
    if (matches.length === 0) {
      unmatched.push(entry);
      continue;
    }
    for (const conn of matches) {
      const existing = buckets.get(conn.id);
      if (existing) existing.entries.push(entry);
      else buckets.set(conn.id, { connection: conn, payload: null, entries: [entry] });
    }
  }

  const routes: DeliveryRoute[] = [...buckets.values()].map((b) => ({
    connection: b.connection,
    payload: { ...(body as object), entry: b.entries },
  }));
  if (unmatched.length > 0) {
    // SEGURIDAD MULTI-TENANT: NO enrutamos los entries sin match a conns[0]
    // (la primera conexión de CUALQUIER workspace) — eso ingeriría el mensaje
    // de un cliente en el inbox del tenant EQUIVOCADO (fuga cross-tenant).
    // Los descartamos y logueamos fuerte para que ops corrija el page_id /
    // ig_user_id guardado de la conexión. Un mismatch persistente es la causa
    // usual de "los mensajes no llegan al inbox" — pero perder un mensaje es
    // preferible a atribuirlo a otro comercio.
    log.warn(
      "webhook entries matched no connection by id — DROPPED (no se enrutan para evitar fuga cross-tenant)",
      {
        channel,
        unmatchedEntryIds: unmatched.map((e) =>
          e && typeof e === "object" ? String((e as { id?: unknown }).id ?? "") : "",
        ),
        knownConnectionIds: conns.map((c) => ({
          id: c.id,
          external_account_id: c.external_account_id,
          config_ids: ["page_id", "ig_user_id", "phone_number_id", "waba_id"]
            .map((k) => (c.config as Record<string, unknown> | null)?.[k])
            .filter(Boolean),
        })),
      },
    );
  }
  return routes;
}

/**
 * True when a webhook `entry` belongs to this connection. Meta puts the
 * page id / IG user id on `entry.id`; WhatsApp puts the WABA id there and
 * the phone number under `entry.changes[].value.metadata.phone_number_id`.
 * We match against every identifier we store (external_account_id plus the
 * config keys) so it works regardless of which id Meta stamped.
 */
function connectionMatchesEntry(
  channel: Channel,
  connection: ChannelConnection,
  entry: unknown,
): boolean {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  if (connection.external_account_id) ids.add(String(connection.external_account_id));
  for (const key of ["page_id", "ig_user_id", "phone_number_id", "waba_id"]) {
    if (cfg[key]) ids.add(String(cfg[key]));
  }

  const e = entry as {
    id?: unknown;
    changes?: Array<{ value?: { metadata?: { phone_number_id?: unknown } } }>;
  };
  if (channel === "whatsapp") {
    for (const ch of e.changes ?? []) {
      const pid = ch?.value?.metadata?.phone_number_id;
      if (pid != null && ids.has(String(pid))) return true;
    }
  }
  return e.id != null && ids.has(String(e.id));
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
    // the id in the URL: pick one for this channel, preferring a
    // connected row but accepting error/expired so a dead-token channel
    // still passes Meta's periodic webhook re-verification (status sorts
    // 'connected' < 'error' < 'expired' ascending).
    const { data } = await supabaseAdmin()
      .from("channel_connections")
      .select("*")
      .eq("channel", channel)
      .in("status", ["connected", "error", "expired"])
      .order("status", { ascending: true })
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
