import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { encrypt } from "@/lib/channels/encryption";
import { subscribePageToWebhooks } from "@/lib/channels/meta-graph";
import type { Channel } from "@/types";

const GRAPH = "https://graph.facebook.com/v21.0";
const META_CHANNELS: Channel[] = [
  "messenger",
  "instagram",
  "fb_comment",
  "ig_comment",
  "whatsapp",
];

/**
 * POST /api/connections/meta/manual
 *
 * Paste-a-token escape hatch for Meta channels when the OAuth dialog
 * is unavailable (apps in development without Business Verification
 * can't use the Business Login wizard, and the classic OAuth dialog
 * is blocked on use-case apps).
 *
 * Body:
 *   { channel, token, page_id?, ig_user_id?, waba_id?, phone_number_id? }
 *
 * For FB Messenger / FB comments / IG DMs / IG comments the token must
 * be a Page Access Token (or a System User token assigned to the
 * page). We resolve `id` and `name` via Graph and persist. For
 * WhatsApp we also accept phone_number_id and waba_id explicitly since
 * the system-user token can address several phone numbers.
 *
 * The token is encrypted with the same key the OAuth flow uses, so
 * downstream adapters work without changes.
 */
export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        channel?: string;
        token?: string;
        page_id?: string;
        ig_user_id?: string;
        waba_id?: string;
        phone_number_id?: string;
        workspace_id?: string;
      }
    | null;
  if (!body || !body.channel || !body.token || !body.workspace_id) {
    return NextResponse.json(
      { error: "channel, token, workspace_id required" },
      { status: 400 },
    );
  }
  if (!META_CHANNELS.includes(body.channel as Channel)) {
    return NextResponse.json({ error: "channel not supported" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", body.workspace_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const channel = body.channel as Channel;
  const token = body.token.trim();

  try {
    if (channel === "whatsapp") {
      return await connectWhatsApp(admin, {
        workspaceId: body.workspace_id,
        userId: user.id,
        token,
        waba_id: body.waba_id,
        phone_number_id: body.phone_number_id,
      });
    }
    return await connectPageChannel(admin, {
      workspaceId: body.workspace_id,
      userId: user.id,
      channel,
      token,
      pageIdHint: body.page_id,
      igUserIdHint: body.ig_user_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

interface PageInsertArgs {
  workspaceId: string;
  userId: string;
  channel: Channel;
  token: string;
  pageIdHint?: string;
  igUserIdHint?: string;
}

// A single page token covers both the DM channel and the comment
// channel for that platform, so one "connect" sets up both. Facebook
// page → Messenger + FB comments; Instagram → IG DMs + IG comments.
const CHANNEL_SIBLINGS: Record<string, Channel[]> = {
  messenger: ["messenger", "fb_comment"],
  fb_comment: ["messenger", "fb_comment"],
  instagram: ["instagram", "ig_comment"],
  ig_comment: ["instagram", "ig_comment"],
};

async function connectPageChannel(
  admin: ReturnType<typeof supabaseAdmin>,
  args: PageInsertArgs,
): Promise<Response> {
  // Verify the token is a Page Access Token by hitting /me with the
  // page fields we need. Page tokens reply with { id, name } where id
  // is the page id.
  const probe = await fetch(
    `${GRAPH}/me?fields=id,name,instagram_business_account{id,username}&access_token=${encodeURIComponent(args.token)}`,
  );
  if (!probe.ok) {
    throw new Error(`token probe failed (${probe.status}): ${await probe.text()}`);
  }
  const profile = (await probe.json()) as {
    id?: string;
    name?: string;
    instagram_business_account?: { id?: string; username?: string };
  };
  if (!profile.id) throw new Error("token did not resolve to a page");

  const pageId = args.pageIdHint ?? profile.id;
  const pageName = profile.name ?? "Facebook Page";
  const igUserId = args.igUserIdHint ?? profile.instagram_business_account?.id;
  const igUsername = profile.instagram_business_account?.username;

  // Expand to both sibling channels so one paste connects DMs + comments.
  const channels = CHANNEL_SIBLINGS[args.channel] ?? [args.channel];
  const needsIg = channels.some((c) => c === "instagram" || c === "ig_comment");
  if (needsIg && !igUserId) {
    throw new Error(
      "this page has no Instagram Professional account attached — link an IG business account first",
    );
  }

  const encryptedToken = encrypt(args.token);
  const created: Channel[] = [];
  const already: Channel[] = [];
  let label = pageName;

  for (const ch of channels) {
    const isIg = ch === "instagram" || ch === "ig_comment";
    const externalAccountId = isIg ? (igUserId as string) : pageId;
    const rowLabel = isIg
      ? igUsername
        ? `${pageName} (@${igUsername})`
        : `${pageName} (Instagram)`
      : pageName;
    const config: Record<string, unknown> = isIg
      ? { page_id: pageId, page_name: pageName, ig_user_id: igUserId }
      : { page_id: pageId, page_name: pageName };

    const { error: insErr } = await admin.from("channel_connections").insert({
      workspace_id: args.workspaceId,
      channel: ch,
      label: rowLabel,
      status: "connected",
      external_account_id: externalAccountId,
      config,
      secrets: { access_token: encryptedToken },
      created_by: args.userId,
    });
    if (insErr) {
      if (insErr.code === "23505") {
        // Already connected — refresh its token + reactivate instead.
        await admin
          .from("channel_connections")
          .update({
            secrets: { access_token: encryptedToken },
            status: "connected",
            last_error: null,
          })
          .eq("workspace_id", args.workspaceId)
          .eq("channel", ch)
          .eq("external_account_id", externalAccountId);
        already.push(ch);
      } else {
        throw new Error(`insert failed (${ch}): ${insErr.message}`);
      }
    } else {
      created.push(ch);
    }
    label = rowLabel;

    // Webhook subscription is best-effort.
    try {
      await subscribePageToWebhooks({
        channel: ch,
        pageId,
        pageAccessToken: args.token,
        igUserId,
      });
    } catch (err) {
      console.warn(`[connections/meta/manual] subscribe failed (${ch}):`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    label,
    created,
    refreshed: already,
  });
}

interface WhatsAppInsertArgs {
  workspaceId: string;
  userId: string;
  token: string;
  waba_id?: string;
  phone_number_id?: string;
}

async function connectWhatsApp(
  admin: ReturnType<typeof supabaseAdmin>,
  args: WhatsAppInsertArgs,
): Promise<Response> {
  if (!args.phone_number_id || !args.waba_id) {
    throw new Error("WhatsApp manual connect needs phone_number_id and waba_id");
  }
  // Probe the phone number to confirm the token has access.
  const probe = await fetch(
    `${GRAPH}/${args.phone_number_id}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(args.token)}`,
  );
  if (!probe.ok) {
    throw new Error(`phone probe failed (${probe.status}): ${await probe.text()}`);
  }
  const phone = (await probe.json()) as {
    display_phone_number?: string;
    verified_name?: string;
  };

  const label = phone.verified_name
    ? `${phone.verified_name} (${phone.display_phone_number ?? ""})`.trim()
    : `WhatsApp ${args.phone_number_id}`;

  const { error: insErr, data: inserted } = await admin
    .from("channel_connections")
    .insert({
      workspace_id: args.workspaceId,
      channel: "whatsapp",
      label,
      status: "connected",
      external_account_id: args.phone_number_id,
      config: {
        phone_number_id: args.phone_number_id,
        waba_id: args.waba_id,
        display_phone_number: phone.display_phone_number,
        verified_name: phone.verified_name,
      },
      secrets: { access_token: encrypt(args.token) },
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json(
        { error: "this phone is already connected to the workspace" },
        { status: 409 },
      );
    }
    throw new Error(`insert failed: ${insErr.message}`);
  }

  return NextResponse.json({ ok: true, connection_id: inserted?.id, label });
}
