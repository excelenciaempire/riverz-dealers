/**
 * Shared OAuth helpers — state token (anti-CSRF) generation +
 * verification, and provider configuration loading.
 */

import crypto from "crypto";

export interface OAuthState {
  /** Workspace the connection will be attached to. */
  workspaceId: string;
  /** Target channel ('whatsapp' / 'instagram' / 'messenger' / 'gmail' /
   *  'outlook' / 'fb_comment' / 'ig_comment'). */
  channel: string;
  /** Issued-at unix ms, for short-window expiry. */
  iat: number;
  /** Nonce, double-purposed as anti-CSRF. */
  nonce: string;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSigningKey(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY not set — required for OAuth state signing");
  return Buffer.from(k, "hex");
}

export function encodeState(payload: Omit<OAuthState, "iat" | "nonce">): string {
  const full: OAuthState = {
    ...payload,
    iat: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSigningKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function decodeState(token: string): OAuthState | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", getSigningKey()).update(body).digest("base64url");
  // Constant-time compare.
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (Date.now() - decoded.iat > STATE_TTL_MS) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function baseUrl(req: Request): string {
  // Prefer the explicit env var so the OAuth redirect URI matches the
  // one registered with Meta / Google / Microsoft even when the app is
  // running behind a reverse proxy that rewrites the Host header.
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

// ── Provider config ────────────────────────────────────────────
interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params to attach on the authorize redirect. */
  extraAuthParams?: Record<string, string>;
  /**
   * Facebook Login for Business configuration id. When set, the authorize
   * call uses `config_id=` (the permissions live in the configuration) and
   * MUST omit `scope` — they're mutually exclusive. Required for App Review
   * of business permissions (the classic scope-based dialog won't load for a
   * Business-type app). Create it in the Meta dashboard → Facebook Login for
   * Business → Configurations, then set NEXT_PUBLIC_META_LOGIN_CONFIG_ID.
   */
  configId?: string;
}

export function metaProvider(): ProviderConfig {
  return {
    clientId: required("META_APP_ID"),
    clientSecret: required("META_APP_SECRET"),
    authorizationUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    configId:
      process.env.META_LOGIN_CONFIG_ID ||
      process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID ||
      undefined,
    scopes: [
      "pages_messaging",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_engagement",
      "pages_manage_metadata",
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "whatsapp_business_management",
      "whatsapp_business_messaging",
      "business_management",
    ],
  };
}

export function googleProvider(): ProviderConfig {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  };
}

export function microsoftProvider(): ProviderConfig {
  return {
    clientId: required("MICROSOFT_CLIENT_ID"),
    clientSecret: required("MICROSOFT_CLIENT_SECRET"),
    // /common allows both personal Outlook/Hotmail and Microsoft 365.
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "Mail.ReadWrite", "Mail.Send", "User.Read"],
    extraAuthParams: { prompt: "select_account" },
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} is not set`);
  return v;
}

export type ProviderName = "meta" | "google" | "microsoft";
export function loadProvider(name: ProviderName): ProviderConfig {
  if (name === "meta") return metaProvider();
  if (name === "google") return googleProvider();
  if (name === "microsoft") return microsoftProvider();
  throw new Error(`Unknown OAuth provider: ${name}`);
}
