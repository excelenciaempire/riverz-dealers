import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import {
  baseUrl,
  encodeState,
  generatePkce,
  loadProvider,
  mercadoLibreAuthHost,
  type ProviderName,
} from "@/lib/channels/oauth";
import { publicBaseUrl } from "@/lib/base-url";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

const VALID: ProviderName[] = ["meta", "google", "microsoft", "zoho", "mercadolibre"];

/**
 * GET /api/connections/:provider/oauth/start?workspace_id=…&channel=…
 *
 * Generates a signed `state` token and redirects the browser to the
 * provider's authorize endpoint. The callback (see ./callback) verifies
 * the same state and persists the resulting credentials in
 * `channel_connections`.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  const locale = await getLocale();
  if (!isProvider(provider)) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.unknownProvider") },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Sobre el dominio público: detrás del proxy de Render `req.url` es la
  // dirección interna (`https://localhost:10000/…`), y esto mandaba a quien no
  // había iniciado sesión a un `localhost` que su navegador no puede abrir.
  if (!user) return NextResponse.redirect(new URL("/ingresar", publicBaseUrl()));

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");
  const channel = url.searchParams.get("channel");
  if (!workspaceId || !channel) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.workspaceAndChannelRequired") },
      { status: 400 },
    );
  }

  // Meta: only the DM channels connect through the generic OAuth redirect.
  // WhatsApp MUST go through Embedded Signup (it needs the legacy whatsapp_config
  // bridge + number registration, which this flow doesn't run), and the comment
  // channels (fb_comment/ig_comment) are derived SIBLINGS created automatically
  // next to their DM channel — never connected standalone. Routing either here
  // would produce a half-wired connection. The UI only ever sends messenger/
  // instagram here, so this is a defensive guard.
  if (provider === "meta" && channel !== "messenger" && channel !== "instagram") {
    return NextResponse.json(
      { error: translate(locale, "errInbox.metaChannelNotConnectable") },
      { status: 400 },
    );
  }

  // Admin-only.
  const { data: membership } = await supabaseAdmin()
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbiddenAdminOnly") },
      { status: 403 },
    );
  }

  let cfg;
  try {
    cfg = loadProvider(provider);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : translate(locale, "errInbox.providerNotConfigured"),
      },
      { status: 500 },
    );
  }

  // MercadoLibre exige PKCE: generamos el par y hacemos viajar el verifier en
  // el state (firmado) para que el callback lo mande en el canje del token.
  const pkce = provider === "mercadolibre" ? generatePkce() : null;
  const state = encodeState({
    workspaceId,
    channel,
    ...(pkce ? { codeVerifier: pkce.verifier } : {}),
  });
  const redirectUri = `${baseUrl(req)}/api/connections/${provider}/oauth/callback`;
  // MercadoLibre es por país: el vendedor se loguea en el dominio de auth de SU
  // país (una sola app autoriza a todos). La UI manda ?ml_country=XX y acá
  // elegimos el host correcto; el redirect_uri y la token API son iguales.
  const authorizeUrl =
    provider === "mercadolibre"
      ? `${mercadoLibreAuthHost(url.searchParams.get("ml_country"))}/authorization`
      : cfg.authorizationUrl;
  const authorize = new URL(authorizeUrl);
  authorize.searchParams.set("client_id", cfg.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  // Facebook Login for Business: when a configuration id is set, the
  // requested permissions live in the configuration and `config_id` REPLACES
  // `scope` (they're mutually exclusive). This is the flow Meta requires for
  // business permissions — the classic scope-based dialog won't load for a
  // Business-type app. Falls back to scope-based for non-Meta providers and
  // when no config_id is configured.
  if (cfg.configId) {
    authorize.searchParams.set("config_id", cfg.configId);
  } else if (cfg.scopes.length > 0) {
    // Scope delimiter: OAuth 2.0 (Google + Microsoft) requires a SPACE between
    // scopes — Microsoft's authorize endpoint rejects a comma-joined list as
    // one invalid scope (AADSTS70011), which silently broke every Outlook
    // connect. Only Meta's legacy scope fallback uses a comma. MercadoLibre
    // configures scopes on the app (empty list here) so the param is omitted.
    authorize.searchParams.set("scope", cfg.scopes.join(provider === "meta" || provider === "zoho" ? "," : " "));
  }
  if (pkce) {
    authorize.searchParams.set("code_challenge", pkce.challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
  }
  authorize.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) {
    authorize.searchParams.set(k, v);
  }
  return NextResponse.redirect(authorize.toString());
}

function isProvider(p: string): p is ProviderName {
  return (VALID as string[]).includes(p);
}
