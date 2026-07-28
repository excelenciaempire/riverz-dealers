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
  /** PKCE code_verifier (MercadoLibre requires PKCE). It rides in the signed
   *  state so the callback can send it in the token exchange. The state is
   *  HMAC-signed (tamper-proof); for a confidential client (we hold the
   *  client_secret) carrying the verifier here is safe. */
  codeVerifier?: string;
  /** Usuario que inició la conexión. Lo usan los flujos de tienda, cuyo
   *  callback puede llegar SIN cookie de sesión (WooCommerce postea las
   *  claves servidor-a-servidor desde el WordPress del comercio), así que
   *  el state es el único vínculo con quién conectó. */
  userId?: string;
  /** Dominio de la tienda que se está conectando (Tiendanube/WooCommerce). */
  storeDomain?: string;
}

/** PKCE (RFC 7636, S256): random verifier + its SHA-256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url"); // 43 chars
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
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
  // Constant-time compare. El chequeo de largo va PRIMERO porque
  // timingSafeEqual lanza —no devuelve false— ante buffers de distinto
  // tamaño: un `state` recortado o basura reventaría el callback con un
  // 500 en vez de rechazarse como corresponde.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
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
      "public_profile",
      "pages_messaging",
      "pages_show_list",
      "pages_read_engagement",
      // Reading user-generated content (the customer's comments) on the
      // Page; Meta requires it alongside pages_manage_engagement to reply
      // to / hide comments. NOTE: production connect uses Facebook Login
      // for Business via config_id, so this list is the fallback only —
      // the same permission must also be added to the config in the Meta
      // dashboard for it to be granted on the config_id path.
      "pages_read_user_content",
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

/**
 * MercadoLibre authorize host per country. UNA sola app autoriza vendedores de
 * CUALQUIER país — solo cambia el dominio de login/consentimiento; la token API
 * y los webhooks son globales (api.mercadolibre.com). Las claves coinciden con
 * los códigos de país que envía la UI de conexión.
 */
const ML_AUTH_HOSTS: Record<string, string> = {
  AR: "https://auth.mercadolibre.com.ar",
  BO: "https://auth.mercadolibre.com.bo",
  BR: "https://auth.mercadolivre.com.br",
  CL: "https://auth.mercadolibre.cl",
  CO: "https://auth.mercadolibre.com.co",
  CR: "https://auth.mercadolibre.co.cr",
  DO: "https://auth.mercadolibre.com.do",
  EC: "https://auth.mercadolibre.com.ec",
  GT: "https://auth.mercadolibre.com.gt",
  MX: "https://auth.mercadolibre.com.mx",
  PA: "https://auth.mercadolibre.com.pa",
  PE: "https://auth.mercadolibre.com.pe",
  PY: "https://auth.mercadolibre.com.py",
  UY: "https://auth.mercadolibre.com.uy",
  VE: "https://auth.mercadolibre.com.ve",
};

/**
 * Resuelve el host de autorización de ML para un código de país (el que manda
 * la UI). Fallback: MERCADOLIBRE_AUTH_HOST o Argentina (sitio de origen de la
 * app). El vendedor debe loguearse en el dominio de SU país.
 */
export function mercadoLibreAuthHost(country?: string | null): string {
  const key = (country || "").trim().toUpperCase();
  const host =
    ML_AUTH_HOSTS[key] ||
    process.env.MERCADOLIBRE_AUTH_HOST ||
    "https://auth.mercadolibre.com.ar";
  return host.replace(/\/$/, "");
}

export function mercadoLibreProvider(): ProviderConfig {
  // El host de autorización es por país; el /oauth/start lo sobreescribe con el
  // país elegido por el merchant vía mercadoLibreAuthHost(). Este default solo
  // aplica si no se pasa país. La token API es global.
  return {
    clientId: required("MERCADOLIBRE_CLIENT_ID"),
    clientSecret: required("MERCADOLIBRE_CLIENT_SECRET"),
    authorizationUrl: `${mercadoLibreAuthHost()}/authorization`,
    tokenUrl: "https://api.mercadolibre.com/oauth/token",
    // ML scopes (offline_access/read/write) are configured on the app, not
    // passed in the authorize URL — empty so the start route omits `scope`.
    scopes: [],
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} is not set`);
  return v;
}

export type ProviderName = "meta" | "google" | "microsoft" | "mercadolibre";
export function loadProvider(name: ProviderName): ProviderConfig {
  if (name === "meta") return metaProvider();
  if (name === "google") return googleProvider();
  if (name === "microsoft") return microsoftProvider();
  if (name === "mercadolibre") return mercadoLibreProvider();
  throw new Error(`Unknown OAuth provider: ${name}`);
}
