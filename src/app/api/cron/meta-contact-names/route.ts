import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import type { ChannelConnection, Contact } from "@/types";

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
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const { data: conns } = await admin
    .from("channel_connections")
    .select("*")
    .in("channel", ["messenger", "instagram", "fb_comment", "ig_comment"])
    .eq("status", "connected");
  if (!conns || conns.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  // Decrypt each connection's page token once and cache by channel.
  const tokens = new Map<string, string>();
  for (const c of conns as ChannelConnection[]) {
    const secrets = (c.secrets ?? {}) as Record<string, unknown>;
    const enc = String(secrets.access_token ?? "");
    if (enc) tokens.set(c.channel, decrypt(enc));
  }

  const results: Record<string, { resolved: number; skipped: number }> = {};

  for (const channel of ["messenger", "instagram", "fb_comment", "ig_comment"] as const) {
    const token = tokens.get(channel);
    if (!token) {
      results[channel] = { resolved: 0, skipped: 0 };
      continue;
    }
    // Pull only contacts that still need a name.
    const { data: contacts } = await admin
      .from("contacts")
      .select("id, external_id, name")
      .eq("channel", channel)
      .is("name", null)
      .limit(500);
    const list = (contacts ?? []) as Pick<Contact, "id" | "external_id" | "name">[];
    let resolved = 0;
    let skipped = 0;
    for (const c of list) {
      if (!c.external_id) {
        skipped++;
        continue;
      }
      const name = await resolveName(channel, c.external_id, token);
      if (!name) {
        skipped++;
        continue;
      }
      await admin.from("contacts").update({ name }).eq("id", c.id);
      resolved++;
    }
    results[channel] = { resolved, skipped };
  }

  return NextResponse.json({ ok: true, results });
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
      `${GRAPH}/${externalId}?fields=${fields}&access_token=${encodeURIComponent(token)}`,
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
