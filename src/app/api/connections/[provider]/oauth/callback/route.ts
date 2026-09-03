import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { baseUrl, decodeState, loadProvider, type ProviderName } from "@/lib/channels/oauth";
import { encrypt } from "@/lib/channels/encryption";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { persistMetaConnections, MetaConnectError } from "@/lib/channels/meta-connect";
import { startGmailWatch } from "@/lib/channels/gmail/watch";
import { startOutlookWatch } from "@/lib/channels/outlook/watch";
import { upsertConnectionRow } from "@/lib/channels/upsert-connection";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { Channel, ChannelConnection } from "@/types";

const VALID: ProviderName[] = ["meta", "google", "microsoft", "zoho", "mercadolibre"];

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
    if (provider === "google" || provider === "microsoft" || provider === "zoho" || provider === "mercadolibre") {
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      // MercadoLibre exige PKCE: el code_verifier viajó en el state firmado y
      // sin él el canje devuelve "code_verifier is a required parameter".
      if (provider === "mercadolibre" && state.codeVerifier) {
        params.set("code_verifier", state.codeVerifier);
      }
      const tokenUrl = provider === "zoho" ? `${zohoAccountsUrl(url.searchParams.get("accounts-server"))}/oauth/v2/token` : cfg.tokenUrl;
      const r = await fetch(tokenUrl, {
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
  let zohoIdentity: { accountId: string; accountsUrl: string; mailUrl: string; inboxFolderId?: string } | undefined;
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
    } else if (provider === "zoho") {
      const accountsUrl = zohoAccountsUrl(url.searchParams.get("accounts-server"));
      const mailUrl = zohoMailUrl(accountsUrl);
      const r = await fetch(`${mailUrl}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/json" } });
      if (r.ok) {
        const j = (await r.json()) as { data?: Array<{ accountId?: string | number; primaryEmailAddress?: string; mailboxAddress?: string; enabled?: boolean; type?: string }> };
        const account = (j.data ?? []).find((a) => a.enabled !== false && a.type !== "IMAP_ACCOUNT") ?? j.data?.[0];
        const email = account?.primaryEmailAddress ?? account?.mailboxAddress;
        if (account?.accountId != null && email) {
          const folders = await fetch(`${mailUrl}/api/accounts/${account.accountId}/folders`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/json" } });
          const folderJson = folders.ok ? ((await folders.json()) as { data?: Array<{ folderId?: string | number; folderType?: string }> }) : null;
          const inboxFolderId = folderJson?.data?.find((folder) => folder.folderType?.toLowerCase() === "inbox")?.folderId;
          label = email;
          externalAccountId = email.toLowerCase();
          zohoIdentity = { accountId: String(account.accountId), accountsUrl, mailUrl, inboxFolderId: inboxFolderId == null ? undefined : String(inboxFolderId) };
        }
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
  //
  // Delegate to the SHARED persistMetaConnections helper — the same one the
  // Facebook-Login SDK flow uses — so both paths stay identical. Critically it
  // also creates the COMMENT sibling row (messenger→fb_comment,
  // instagram→ig_comment); the old inline loop here omitted it, so a merchant
  // connected via this redirect flow received DMs but their comment webhooks
  // matched no connection and were silently dropped.
  if (provider === "meta") {
    try {
      const { saved, subscribed } = await persistMetaConnections(admin, {
        accessToken,
        channel,
        workspaceId: state.workspaceId,
        userId: user.id,
        baseSecrets,
      });
      return redirectWithStatus(req, "ok", `${saved} saved, ${subscribed} subscribed`);
    } catch (err) {
      if (err instanceof MetaConnectError) {
        return redirectWithStatus(req, "error", err.message);
      }
      console.error(`[oauth/meta] persist failed:`, err);
      return redirectWithStatus(req, "error", "could not connect Meta account");
    }
  }

  // Non-Meta providers (Google, Microsoft, MercadoLibre) — single
  // connection per OAuth flow. Reconnecting the same mailbox/seller
  // revives its existing row instead of stacking a duplicate.
  const secrets: Record<string, unknown> = { ...baseSecrets, access_token: encrypt(accessToken) };
  const rowConfig =
    channel === "gmail" || channel === "outlook"
      ? { email: label ?? externalAccountId }
      : channel === "zoho"
        ? { email: label ?? externalAccountId, zoho_account_id: zohoIdentity?.accountId, zoho_accounts_url: zohoIdentity?.accountsUrl, zoho_mail_url: zohoIdentity?.mailUrl, zoho_inbox_folder_id: zohoIdentity?.inboxFolderId }
      : channel === "mercadolibre"
        ? {
            seller_id: externalAccountId,
            site_id: mlSiteId,
            token_expires_at: tokenJson.expires_in
              ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString()
              : undefined,
          }
        : {};
  // Gmail/Outlook REQUIRE the mailbox address as identity: it is the upsert key
  // (so reconnecting revives the same row instead of stacking duplicates) AND
  // Gmail's Pub/Sub push routes by email. If profile discovery failed, refuse
  // rather than persist an identity-less mailbox that can't receive and would
  // duplicate on every reconnect.
  if ((channel === "gmail" || channel === "outlook" || channel === "zoho") && !externalAccountId) {
    console.error(`[oauth/${provider}] mailbox profile discovery returned no address`);
    return redirectWithStatus(req, "error", "could not read mailbox address");
  }
  if (channel === "zoho" && !zohoIdentity?.inboxFolderId) return redirectWithStatus(req, "error", "could not read Zoho inbox");

  let inserted: ChannelConnection | null = null;
  if (externalAccountId) {
    const up = await upsertConnectionRow(admin, {
      workspace_id: state.workspaceId,
      channel,
      label: label ?? channelLabel(channel),
      external_account_id: externalAccountId,
      config: rowConfig,
      secrets,
      created_by: user.id,
    });
    if (up.error || !up.id) {
      console.error(`[oauth/${provider}] persist failed:`, up.error);
      return redirectWithStatus(req, "error", up.error ?? "persist failed");
    }
    const { data: fullRow } = await admin
      .from("channel_connections")
      .select("*")
      .eq("id", up.id)
      .maybeSingle();
    inserted = (fullRow as ChannelConnection | null) ?? null;
  } else {
    // Identity unknown (provider didn't return one) — plain insert; the
    // unique index ignores NULL external_account_id.
    const { data, error: insErr } = await admin
      .from("channel_connections")
      .insert({
        workspace_id: state.workspaceId,
        channel,
        label: label ?? channelLabel(channel),
        status: "connected",
        external_account_id: externalAccountId,
        config: rowConfig,
        secrets,
        created_by: user.id,
      })
      .select("*")
      .maybeSingle();
    if (insErr) {
      console.error(`[oauth/${provider}] persist failed:`, insErr);
      return redirectWithStatus(req, "error", insErr.message);
    }
    inserted = (data as ChannelConnection | null) ?? null;
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

function zohoAccountsUrl(value: string | null): string {
  const fallback = (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/$/, "");
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && /^accounts\.zoho\.(com|eu|in|com\.au|jp|com\.cn|sa|ca)$/.test(parsed.hostname) ? parsed.origin : fallback;
  } catch { return fallback; }
}

function zohoMailUrl(accountsUrl: string): string {
  return (process.env.ZOHO_MAIL_API_URL?.trim() || accountsUrl.replace("//accounts.", "//mail.")).replace(/\/$/, "");
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
