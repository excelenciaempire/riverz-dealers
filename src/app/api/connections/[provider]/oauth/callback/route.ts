import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { baseUrl, decodeState, loadProvider, type ProviderName } from "@/lib/channels/oauth";
import { encrypt } from "@/lib/channels/encryption";
import {
  discoverMetaAccounts,
  subscribePageToWebhooks,
  withAppsecretProof,
} from "@/lib/channels/meta-graph";
import { startGmailWatch } from "@/lib/channels/gmail/watch";
import { startOutlookWatch } from "@/lib/channels/outlook/watch";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { Channel, ChannelConnection } from "@/types";

const VALID: ProviderName[] = ["meta", "google", "microsoft", "mercadolibre"];

/**
 * GET /api/connections/:provider/oauth/callback?code=…&state=…
 *
 * Exchanges the OAuth code for tokens and writes a row into
 * `channel_connections` for the workspace + channel encoded in `state`.
 * Then redirects back to /integraciones with a status param.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) {
    const locale = await getLocale();
    return NextResponse.json(
      { error: translate(locale, "errInbox.unknownProvider") },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return redirectWithStatus(req, "error", oauthError);
  }
  if (!code || !stateToken) {
    return redirectWithStatus(req, "error", "missing code or state");
  }

  const state = decodeState(stateToken);
  if (!state) {
    return redirectWithStatus(req, "error", "invalid or expired state");
  }

  // Confirm caller is the admin who initiated the flow.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectWithStatus(req, "error", "not signed in");
  }
  const { data: membership } = await supabaseAdmin()
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", state.workspaceId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return redirectWithStatus(req, "error", "Forbidden");
  }

  // Exchange the code for tokens.
  const cfg = loadProvider(provider);
  const redirectUri = `${baseUrl(req)}/api/connections/${provider}/oauth/callback`;

  let tokenJson: Record<string, unknown>;
  try {
    if (provider === "google" || provider === "microsoft" || provider === "mercadolibre") {
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const r = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!r.ok) throw new Error(await r.text());
      tokenJson = (await r.json()) as Record<string, unknown>;
    } else {
      // Meta exchanges via GET with query params.
      const tokenUrl = new URL(cfg.tokenUrl);
      tokenUrl.searchParams.set("client_id", cfg.clientId);
      tokenUrl.searchParams.set("client_secret", cfg.clientSecret);
      tokenUrl.searchParams.set("redirect_uri", redirectUri);
      tokenUrl.searchParams.set("code", code);
      const r = await fetch(tokenUrl.toString());
      if (!r.ok) throw new Error(await r.text());
      tokenJson = (await r.json()) as Record<string, unknown>;

      // Swap the short-lived user token (1-2h) for the long-lived one
      // (~60d). Without this, every Meta connection (Messenger / IG /
      // FB comments / WA non-ES) would silently die well before day 60.
      // Page tokens we then mint from /me/accounts are themselves
      // long-lived/non-expiring as long as the user token is long-lived.
      // Non-fatal: if the exchange fails we fall through with the
      // short-lived token rather than breaking the connect flow.
      try {
        const llUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
        llUrl.searchParams.set("grant_type", "fb_exchange_token");
        llUrl.searchParams.set("client_id", cfg.clientId);
        llUrl.searchParams.set("client_secret", cfg.clientSecret);
        llUrl.searchParams.set("fb_exchange_token", String(tokenJson.access_token ?? ""));
        const ll = await fetch(llUrl.toString());
        if (ll.ok) tokenJson = (await ll.json()) as Record<string, unknown>;
      } catch (err) {
        console.warn("[oauth/meta] fb_exchange_token failed (non-fatal):", err);
      }
    }
  } catch (err) {
    console.error(`[oauth/${provider}] token exchange failed:`, err);
    return redirectWithStatus(req, "error", "token exchange failed");
  }

  const accessToken = String(tokenJson.access_token ?? "");
  const refreshToken = String(tokenJson.refresh_token ?? "");
  if (!accessToken) {
    return redirectWithStatus(req, "error", "no access_token in response");
  }

  // Discover the connected account label/email so the connection card
  // shows something meaningful.
  let label: string | undefined;
  let externalAccountId: string | undefined;
  let mlSiteId: string | undefined;
  try {
    if (provider === "mercadolibre") {
      const r = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const j = (await r.json()) as { id?: number; nickname?: string; site_id?: string };
        label = j.nickname ?? "Mercado Libre";
        externalAccountId = j.id != null ? String(j.id) : undefined;
        mlSiteId = j.site_id;
      }
    } else if (provider === "google") {
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const j = (await r.json()) as { emailAddress?: string };
        label = j.emailAddress;
        externalAccountId = j.emailAddress;
      }
    } else if (provider === "microsoft") {
      const r = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const j = (await r.json()) as { userPrincipalName?: string; mail?: string };
        label = j.mail ?? j.userPrincipalName;
        externalAccountId = label;
      }
    } else if (provider === "meta") {
      // For Meta connections the externalAccountId depends on the
      // selected channel — phone_number_id (whatsapp), page_id
      // (messenger/fb_comment) or ig_user_id (instagram/ig_comment).
      // We persist a generic label here; the wizard (Phase 9+) will
      // surface a page/account picker that fills in the rest.
      const r = await fetch(
        withAppsecretProof(
          `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
          accessToken,
        ),
      );
      if (r.ok) {
        const j = (await r.json()) as { id?: string; name?: string };
        label = j.name ?? "Meta account";
        externalAccountId = j.id;
      }
    }
  } catch (err) {
    console.warn(`[oauth/${provider}] account discovery failed:`, err);
  }

  const channel = state.channel as Channel;
  const baseSecrets: Record<string, unknown> = {};
  if (refreshToken) baseSecrets.refresh_token = encrypt(refreshToken);
  if (tokenJson.expires_in) {
    baseSecrets.access_token_expires_at = new Date(
      Date.now() + Number(tokenJson.expires_in) * 1000,
    ).toISOString();
  }

  const admin = supabaseAdmin();

  // Meta connections: discover pages/IG accounts/WABA phone numbers and
  // create one channel_connections row per discoverable account, then
  // subscribe each one to the right webhook fields automatically (this
  // is what business.facebook.com does under the hood — no manual
  // webhook setup in developers.facebook.com required).
  if (provider === "meta") {
    let discovered;
    try {
      discovered = await discoverMetaAccounts(accessToken, channel);
    } catch (err) {
      console.error(`[oauth/meta] discovery failed:`, err);
      return redirectWithStatus(req, "error", "could not list pages/accounts");
    }
    if (discovered.length === 0) {
      return redirectWithStatus(
        req,
        "error",
        channel === "instagram" || channel === "ig_comment"
          ? "no IG Professional accounts found on your pages"
          : "no manageable pages or WhatsApp numbers found",
      );
    }

    let saved = 0;
    let subscribed = 0;
    for (const account of discovered) {
      const secrets = {
        ...baseSecrets,
        access_token: encrypt(account.page_access_token),
        user_access_token: encrypt(accessToken),
      };
      const { error: insErr } = await admin.from("channel_connections").insert({
        workspace_id: state.workspaceId,
        channel,
        label: account.label,
        status: "connected",
        external_account_id: account.external_account_id,
        config: account.config,
        secrets,
        created_by: user.id,
      });
      if (insErr) {
        // 23505 duplicate is fine — admin reconnected.
        if (insErr.code !== "23505") {
          console.error(`[oauth/meta] insert failed for ${account.label}:`, insErr);
          continue;
        }
      }
      saved++;

      // Subscribe to the relevant webhook fields (skip for whatsapp;
      // WhatsApp Cloud subscribes at the app level via developers UI).
      if (channel !== "whatsapp") {
        const pageId = String(account.config.page_id ?? account.external_account_id);
        const igUserId = account.config.ig_user_id as string | undefined;
        try {
          await subscribePageToWebhooks({
            channel,
            pageId,
            pageAccessToken: account.page_access_token,
            igUserId,
          });
          subscribed++;
        } catch (err) {
          console.warn(`[oauth/meta] subscribe failed for ${account.label}:`, err);
        }
      }
    }
    return redirectWithStatus(req, "ok", `${saved} saved, ${subscribed} subscribed`);
  }

  // Non-Meta providers (Google, Microsoft) — single connection per OAuth flow.
  const secrets: Record<string, unknown> = { ...baseSecrets, access_token: encrypt(accessToken) };
  const { data: inserted, error: upsertErr } = await admin
    .from("channel_connections")
    .insert({
      workspace_id: state.workspaceId,
      channel,
      label: label ?? channelLabel(channel),
      status: "connected",
      external_account_id: externalAccountId,
      config:
        channel === "gmail" || channel === "outlook"
          ? { email: label ?? externalAccountId }
          : channel === "mercadolibre"
            ? {
                seller_id: externalAccountId,
                site_id: mlSiteId,
                token_expires_at: tokenJson.expires_in
                  ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString()
                  : undefined,
              }
            : {},
      secrets,
      created_by: user.id,
    })
    .select("*")
    .maybeSingle();
  if (upsertErr) {
    console.error(`[oauth/${provider}] persist failed:`, upsertErr);
    return redirectWithStatus(req, "error", upsertErr.message);
  }

  // Gmail: arm the Pub/Sub watch right away so the user gets real-time
  // delivery from the moment they connect, not 6 days later when the
  // cron fires. Best-effort — a missing GMAIL_PUSH_TOPIC env or a
  // transient watch error doesn't unmake the connection; the polling
  // cron still covers them every 5 min and the renew cron will retry.
  if (channel === "gmail" && inserted) {
    try {
      const r = await startGmailWatch(admin, inserted as ChannelConnection);
      if (r.error) {
        console.warn(`[oauth/gmail] watch arming failed: ${r.error}`);
      }
    } catch (err) {
      console.warn(`[oauth/gmail] watch arming threw:`, err);
    }
  }

  // Outlook: arm the Graph push subscription right away so mail flows
  // in real time from the moment of connect. Best-effort — the 5-min
  // poll cron and the renew cron both cover a missed/failed arm.
  if (channel === "outlook" && inserted) {
    try {
      const notificationUrl = `${baseUrl(req)}/api/channels/outlook/webhook`;
      const r = await startOutlookWatch(admin, inserted as ChannelConnection, notificationUrl);
      if (r.error) {
        console.warn(`[oauth/outlook] watch arming failed: ${r.error}`);
      }
    } catch (err) {
      console.warn(`[oauth/outlook] watch arming threw:`, err);
    }
  }

  return redirectWithStatus(req, "ok");
}

function isProvider(p: string): p is ProviderName {
  return (VALID as string[]).includes(p);
}

function redirectWithStatus(req: Request, status: "ok" | "error", detail?: string): Response {
  const url = new URL("/integraciones", baseUrl(req));
  url.searchParams.set("oauth", status);
  if (detail) url.searchParams.set("detail", detail);
  return NextResponse.redirect(url.toString());
}

function channelLabel(channel: Channel): string {
  return channel.replace("_", " ");
}
