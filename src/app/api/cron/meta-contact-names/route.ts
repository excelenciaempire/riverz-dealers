import { NextResponse } from "next/server";
import { listConnections } from "@/lib/channels/connections";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { buildParticipantMap } from "@/lib/channels/meta-participants";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import type { ChannelConnection, Contact } from "@/types";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  forEachWithConcurrency,
} from "@/lib/async/concurrency";
import { withCronRun } from "@/lib/cron/heartbeat";

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * GET /api/cron/meta-contact-names
 *
 * Backfills the human-readable name (or @username) on every Meta
 * contact whose `name` is still null — the old Messenger / Instagram
 * adapters didn't fetch profiles, so existing rows display the raw
 * PSID / IGSID. One Graph call per contact resolves it.
 *
 * Channels covered: messenger, instagram, fb_comment, ig_comment.
 * Auth: `x-cron-secret` matches AUTOMATION_CRON_SECRET.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const conns = await listConnections(admin, {
    channels: ["messenger", "instagram", "fb_comment", "ig_comment"],
    statuses: ["connected"],
  });
  if (conns.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  // Iterate PER CONNECTION (not per channel) so this is multi-tenant: each
  // connection resolves ONLY its own workspace's contacts with its OWN page
  // token. Keying by channel (last connection wins) + building the participant
  // map from just the first connection would resolve every tenant's contacts
  // with one workspace's token — wrong names or none at all for the rest.
  const results: Array<{
    connectionId: string;
    channel: string;
    resolved: number;
    skipped: number;
    failed: number;
    error?: string;
  }> = [];

  await forEachWithConcurrency(
    conns as ChannelConnection[],
    DEFAULT_CONNECTION_CONCURRENCY,
    async (c) => {
      const secrets = (c.secrets ?? {}) as Record<string, unknown>;
      const enc = String(secrets.access_token ?? "");
      if (!enc) {
        results.push({
          connectionId: c.id,
          channel: c.channel,
          resolved: 0,
          skipped: 0,
          failed: 1,
          error: "conexión sin access_token",
        });
        return;
      }
      let token: string;
      try {
        token = decrypt(enc);
      } catch {
        results.push({
          connectionId: c.id,
          channel: c.channel,
          resolved: 0,
          skipped: 0,
          failed: 1,
          error: "access_token ilegible",
        });
        return;
      }
      const channel = c.channel;

      // For DM channels, the per-id profile lookup (/{IGSID}?fields=username)
      // is unreliable on Instagram — in practice it returns nothing for DM
      // senders. The reliable source is the conversations API, whose
      // `participants` carry each person's username/name. Build that map from
      // THIS connection and resolve from it first; fall back to the per-id lookup.
      let participantMap: Map<string, string> | null = null;
      if (channel === "instagram" || channel === "messenger") {
        participantMap = await buildParticipantMap(channel, c, token).catch(
          () => null,
        );
      }

      // Pull only THIS workspace's contacts on this channel that still need a name.
      const { data: contacts, error: contactsError } = await admin
        .from("contacts")
        .select("id, external_id, name, conversations!inner(connection_id)")
        .eq("workspace_id", c.workspace_id)
        .eq("channel", channel)
        .eq("conversations.connection_id", c.id)
        .is("name", null)
        .limit(500);
      if (contactsError) {
        results.push({
          connectionId: c.id,
          channel,
          resolved: 0,
          skipped: 0,
          failed: 1,
          error: contactsError.message,
        });
        return;
      }
      const list = (contacts ?? []) as Pick<
        Contact,
        "id" | "external_id" | "name"
      >[];
      let resolved = 0;
      let skipped = 0;
      let failed = 0;
      for (const ct of list) {
        if (!ct.external_id) {
          skipped++;
          continue;
        }
        const name =
          participantMap?.get(ct.external_id) ??
          (await resolveName(channel, ct.external_id, token));
        if (!name) {
          skipped++;
          continue;
        }
        const { error } = await admin
          .from("contacts")
          .update({ name })
          .eq("id", ct.id);
        if (error) {
          failed++;
          continue;
        }
        resolved++;
      }
      results.push({ connectionId: c.id, channel, resolved, skipped, failed });
    },
  );

  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  return NextResponse.json(
    { ok: failed === 0, failed, results },
    { status: failed ? 207 : 200 },
  );
}

async function resolveName(
  channel: string,
  externalId: string,
  token: string,
): Promise<string | undefined> {
  const wantsUsername = channel === "instagram" || channel === "ig_comment";
  const fields = wantsUsername ? "username,name" : "name";
  try {
    const r = await fetch(
      withAppsecretProof(
        `${GRAPH}/${externalId}?fields=${fields}&access_token=${encodeURIComponent(token)}`,
        token,
      ),
    );
    if (!r.ok) return undefined;
    const j = (await r.json()) as { username?: string; name?: string };
    if (wantsUsername && j.username?.trim()) return `@${j.username.trim()}`;
    if (j.name?.trim()) return j.name.trim();
    return undefined;
  } catch {
    return undefined;
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("meta-contact-names", cronHandler);
