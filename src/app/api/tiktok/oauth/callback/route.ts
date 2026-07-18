import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { baseUrl, decodeState } from "@/lib/channels/oauth";
import { encrypt } from "@/lib/channels/encryption";
import { upsertConnectionRow } from "@/lib/channels/upsert-connection";

const TT = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * GET /api/tiktok/oauth/callback?auth_code=…&state=…
 *
 * The TikTok account holder redirect URL registered on the app (exact match
 * required by /tt_user/oauth2/token/). Exchanges the one-shot auth_code for
 * the 24h access token + 1y refresh token, resolves the Business Account
 * identity, and upserts the tiktok_comment connection.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // TikTok sends `auth_code` (Business flow); accept `code` defensively.
  const authCode = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!authCode || !stateToken) return redirectWithStatus(req, "error", "missing code or state");
  const state = decodeState(stateToken);
  if (!state || state.channel !== "tiktok_comment") {
    return redirectWithStatus(req, "error", "invalid or expired state");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectWithStatus(req, "error", "session expired");

  const appId = process.env.TIKTOK_APP_ID;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !appSecret) return redirectWithStatus(req, "error", "TikTok app not configured");

  // ── Exchange the auth code ──
  const tokenRes = await fetch(`${TT}/tt_user/oauth2/token/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      auth_code: authCode,
      redirect_uri: `${baseUrl(req)}/api/tiktok/oauth/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      creator_id?: string;
      business_id?: string;
      scope?: string | string[];
    };
  };
  const tok = tokenJson.data;
  if (!tokenRes.ok || (tokenJson.code ?? 0) !== 0 || !tok?.access_token) {
    return redirectWithStatus(req, "error", tokenJson.message ?? "token exchange failed");
  }
  const businessId = String(tok.open_id ?? tok.creator_id ?? tok.business_id ?? "");
  if (!businessId) return redirectWithStatus(req, "error", "no account id in token response");

  // ── Resolve the Business Account identity (label for the UI) ──
  let username = "";
  let displayName = "";
  try {
    const infoRes = await fetch(
      `${TT}/business/get/?business_id=${encodeURIComponent(businessId)}` +
        `&fields=${encodeURIComponent(JSON.stringify(["username", "display_name"]))}`,
      { headers: { "Access-Token": tok.access_token } },
    );
    const info = (await infoRes.json().catch(() => ({}))) as {
      code?: number;
      data?: { username?: string; display_name?: string };
    };
    if ((info.code ?? 0) === 0) {
      username = String(info.data?.username ?? "");
      displayName = String(info.data?.display_name ?? "");
    }
  } catch {
    /* label falls back below — connection still works */
  }

  const up = await upsertConnectionRow(supabaseAdmin(), {
    workspace_id: state.workspaceId,
    channel: "tiktok_comment",
    label: displayName || (username ? `@${username}` : "TikTok"),
    external_account_id: businessId,
    config: {
      business_id: businessId,
      username,
      display_name: displayName,
      token_expires_at: new Date(Date.now() + (tok.expires_in ?? 86_400) * 1000).toISOString(),
    },
    secrets: {
      access_token: encrypt(tok.access_token),
      ...(tok.refresh_token ? { refresh_token: encrypt(tok.refresh_token) } : {}),
    },
    created_by: user.id,
  });
  if (up.error) return redirectWithStatus(req, "error", up.error);
  return redirectWithStatus(req, "ok");
}

function redirectWithStatus(req: Request, status: "ok" | "error", detail?: string): Response {
  const u = new URL("/integraciones", baseUrl(req));
  u.searchParams.set("oauth", status);
  if (detail) u.searchParams.set("detail", detail);
  return NextResponse.redirect(u.toString());
}
