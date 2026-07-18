import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { encrypt } from "@/lib/channels/encryption";
import { subscribePageToWebhooks, withAppsecretProof } from "@/lib/channels/meta-graph";
import { refreshMessagingLimitTier } from "@/lib/whatsapp/tier-cap";
import {
  upsertSingleWhatsAppConnection,
  syncLegacyWhatsAppConfig,
  WhatsAppAlreadyConnectedError,
} from "@/lib/channels/whatsapp/connect";
import { upsertConnectionRow } from "@/lib/channels/upsert-connection";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
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
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );
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
      { error: translate(locale, "errInbox.metaManualMissingFields") },
      { status: 400 },
    );
  }
  if (!META_CHANNELS.includes(body.channel as Channel)) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.channelNotSupported") },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
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
    if (err instanceof WhatsAppAlreadyConnectedError) {
      return NextResponse.json(
        {
          error: translate(locale, "errInbox.whatsappAlreadyConnected", {
            label: err.existingLabel,
          }),
        },
        { status: 409 },
      );
    }
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
    withAppsecretProof(
      `${GRAPH}/me?fields=id,name,instagram_business_account{id,username}&access_token=${encodeURIComponent(args.token)}`,
      args.token,
    ),
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

    const up = await upsertConnectionRow(admin, {
      workspace_id: args.workspaceId,
      channel: ch,
      label: rowLabel,
      external_account_id: externalAccountId,
      config,
      secrets: { access_token: encryptedToken },
      created_by: args.userId,
    });
    if (up.error) {
      throw new Error(`upsert failed (${ch}): ${up.error}`);
    }
    if (up.revived) already.push(ch);
    else created.push(ch);
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
  // Probe the phone number to confirm the token has access. We also read
  // is_on_biz_app (Coexistence) for informational purposes — Business
  // App / coexistence numbers are allowed; if a number turns out not to
  // deliver inbound, that surfaces as a connection warning rather than a
  // hard block here.
  const probe = await fetch(
    withAppsecretProof(
      `${GRAPH}/${args.phone_number_id}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type&access_token=${encodeURIComponent(args.token)}`,
      args.token,
    ),
  );
  if (!probe.ok) {
    throw new Error(`phone probe failed (${probe.status}): ${await probe.text()}`);
  }
  const phone = (await probe.json()) as {
    display_phone_number?: string;
    verified_name?: string;
    is_on_biz_app?: boolean;
    platform_type?: string;
  };

  // One WhatsApp per workspace; reconnecting the same number updates in
  // place. A different number while one is active throws
  // WhatsAppAlreadyConnectedError → 409 (handled by the POST catch).
  const { connectionId, label } = await upsertSingleWhatsAppConnection(admin, {
    workspaceId: args.workspaceId,
    userId: args.userId,
    token: args.token,
    phoneNumberId: args.phone_number_id,
    wabaId: args.waba_id,
    displayPhoneNumber: phone.display_phone_number,
    verifiedName: phone.verified_name,
    coexistence: Boolean(phone.is_on_biz_app),
    onboarding: "manual",
  });

  // Cache the WABA messaging-tier so bulk paths can gate sends without
  // a Meta roundtrip per message. Best-effort: errors leave the cached
  // tier as NULL (treated as TIER_50 — safest default).
  await refreshMessagingLimitTier(admin, {
    connectionId,
    wabaId: args.waba_id,
    accessToken: args.token,
  });

  // Bridge to the legacy whatsapp_config table so automations / flows /
  // templates / broadcasts / agents can send through this number too.
  await syncLegacyWhatsAppConfig(admin, {
    workspaceId: args.workspaceId,
    phoneNumberId: args.phone_number_id,
    wabaId: args.waba_id,
    token: args.token,
  });

  return NextResponse.json({ ok: true, connection_id: connectionId, label });
}
